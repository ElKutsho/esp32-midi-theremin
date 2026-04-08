/*
 * vmidi_km.cpp — Virtual MIDI Kernel-Mode PortCls Miniport Driver
 *
 * Creates virtual MIDI input/output port pairs with internal loopback.
 * Data written to the output appears on the corresponding input.
 */

#include "vmidi_km.h"

// ============================================================================
// Kernel new/delete operators
// ============================================================================

void* __cdecl operator new(size_t size, POOL_TYPE poolType, ULONG tag) {
    return ExAllocatePool2(POOL_FLAG_NON_PAGED, size, tag);
}

void __cdecl operator delete(void* p, size_t) {
    if (p) ExFreePool(p);
}

void __cdecl operator delete(void* p) {
    if (p) ExFreePool(p);
}

// ============================================================================
// Topology Descriptors
// ============================================================================

static KSDATARANGE MidiDataRange = {
    sizeof(KSDATARANGE),
    0, 0, 0,
    STATICGUIDOF(KSDATAFORMAT_TYPE_MUSIC),
    STATICGUIDOF(KSDATAFORMAT_SUBTYPE_MIDI),
    STATICGUIDOF(KSDATAFORMAT_SPECIFIER_NONE)
};

static PKSDATARANGE MidiDataRanges[] = { &MidiDataRange };

// Pin 0: Sink (app writes MIDI out) — KSPIN_DATAFLOW_IN
// Pin 1: Source (app reads MIDI in)  — KSPIN_DATAFLOW_OUT
static PCPIN_DESCRIPTOR MidiPinDescriptors[] = {
    // Pin 0 — Render (MIDI Output from application)
    {
        1, 1, 0,            // instances
        NULL,               // AutomationTable
        {
            0, NULL,        // Interfaces
            0, NULL,        // Mediums
            SIZEOF_ARRAY(MidiDataRanges),
            MidiDataRanges,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_SINK,
            NULL,           // Category
            NULL,           // Name
            0               // ConstrainedDataRangesCount
        }
    },
    // Pin 1 — Capture (MIDI Input to application)
    {
        1, 1, 0,
        NULL,
        {
            0, NULL,
            0, NULL,
            SIZEOF_ARRAY(MidiDataRanges),
            MidiDataRanges,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_SINK,
            NULL,
            NULL,
            0
        }
    }
};

// No nodes needed for simple loopback
static PCFILTER_DESCRIPTOR MidiFilterDescriptor = {
    0,                                      // Version
    NULL,                                   // AutomationTable
    sizeof(PCPIN_DESCRIPTOR),               // PinSize
    SIZEOF_ARRAY(MidiPinDescriptors),       // PinCount
    MidiPinDescriptors,                     // Pins
    0,                                      // NodeSize
    0,                                      // NodeCount
    NULL,                                   // Nodes
    0,                                      // ConnectionCount
    NULL,                                   // Connections
    0,                                      // CategoryCount
    NULL                                    // Categories
};

// ============================================================================
// CMiniportMidi — IUnknown
// ============================================================================

CMiniportMidi::CMiniportMidi()
    : m_ref(1)
    , m_pPort(NULL)
    , m_pCaptureStream(NULL)
{
    RtlZeroMemory(&m_ring, sizeof(m_ring));
}

CMiniportMidi::~CMiniportMidi() {
    if (m_pPort) {
        m_pPort->Release();
        m_pPort = NULL;
    }
}

STDMETHODIMP CMiniportMidi::QueryInterface(REFIID riid, PVOID* ppv) {
    if (!ppv) return STATUS_INVALID_PARAMETER;

    if (IsEqualGUIDAligned(riid, IID_IUnknown)) {
        *ppv = (PUNKNOWN)(PMINIPORTMIDI)this;
    } else if (IsEqualGUIDAligned(riid, IID_IMiniport)) {
        *ppv = (PMINIPORT)(PMINIPORTMIDI)this;
    } else if (IsEqualGUIDAligned(riid, IID_IMiniportMidi)) {
        *ppv = (PMINIPORTMIDI)this;
    } else {
        *ppv = NULL;
        return STATUS_INVALID_PARAMETER;
    }

    AddRef();
    return STATUS_SUCCESS;
}

STDMETHODIMP_(ULONG) CMiniportMidi::AddRef() {
    return InterlockedIncrement(&m_ref);
}

STDMETHODIMP_(ULONG) CMiniportMidi::Release() {
    LONG ref = InterlockedDecrement(&m_ref);
    if (ref == 0) {
        this->~CMiniportMidi();
        ExFreePool(this);
    }
    return ref;
}

// ============================================================================
// CMiniportMidi — IMiniportMidi
// ============================================================================

NTSTATUS CMiniportMidi::Init(
    PUNKNOWN       pUnknownAdapter,
    PRESOURCELIST  pResourceList,
    PPORTMIDI      pPort,
    PSERVICEGROUP* ppServiceGroup
) {
    UNREFERENCED_PARAMETER(pUnknownAdapter);
    UNREFERENCED_PARAMETER(pResourceList);

    m_pPort = pPort;
    m_pPort->AddRef();

    m_ring.writePos = 0;
    m_ring.readPos = 0;

    *ppServiceGroup = NULL;
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidi::GetDescription(PPCFILTER_DESCRIPTOR* ppFilterDescriptor) {
    *ppFilterDescriptor = &MidiFilterDescriptor;
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidi::DataRangeIntersection(
    ULONG        PinId,
    PKSDATARANGE DataRange,
    PKSDATARANGE MatchingDataRange,
    ULONG        OutputBufferLength,
    PVOID        ResultantFormat,
    PULONG       ResultantFormatLength
) {
    UNREFERENCED_PARAMETER(PinId);
    UNREFERENCED_PARAMETER(DataRange);
    UNREFERENCED_PARAMETER(MatchingDataRange);
    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(ResultantFormat);
    UNREFERENCED_PARAMETER(ResultantFormatLength);

    // Return not-implemented so PortCls uses default intersection logic
    return STATUS_NOT_IMPLEMENTED;
}

NTSTATUS CMiniportMidi::NewStream(
    PMINIPORTMIDISTREAM* ppStream,
    PUNKNOWN             pOuterUnknown,
    POOL_TYPE            PoolType,
    ULONG                uPin,
    BOOLEAN              bCapture,
    PKSDATAFORMAT        pDataFormat,
    PSERVICEGROUP*       ppServiceGroup
) {
    UNREFERENCED_PARAMETER(pOuterUnknown);
    UNREFERENCED_PARAMETER(PoolType);
    UNREFERENCED_PARAMETER(uPin);
    UNREFERENCED_PARAMETER(pDataFormat);

    CMiniportMidiStream* pStream = new (NonPagedPoolNx, VMIDI_POOL_TAG)
        CMiniportMidiStream();
    if (!pStream) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    NTSTATUS status = pStream->Init(this, bCapture);
    if (!NT_SUCCESS(status)) {
        pStream->Release();
        return status;
    }

    if (bCapture) {
        m_pCaptureStream = pStream;
    }

    *ppStream = (PMINIPORTMIDISTREAM)pStream;
    *ppServiceGroup = NULL;

    return STATUS_SUCCESS;
}

void CMiniportMidi::Service() {
    // Port driver calls this when we signal Notify()
}

void CMiniportMidi::NotifyInput() {
    if (m_pPort) {
        m_pPort->Notify(NULL);
    }
}

// ============================================================================
// CMiniportMidiStream — IUnknown
// ============================================================================

CMiniportMidiStream::CMiniportMidiStream()
    : m_ref(1)
    , m_pMiniport(NULL)
    , m_bCapture(FALSE)
    , m_state(KSSTATE_STOP)
{
}

CMiniportMidiStream::~CMiniportMidiStream() {
    if (m_pMiniport) {
        if (m_bCapture) {
            m_pMiniport->m_pCaptureStream = NULL;
        }
        m_pMiniport->Release();
        m_pMiniport = NULL;
    }
}

STDMETHODIMP CMiniportMidiStream::QueryInterface(REFIID riid, PVOID* ppv) {
    if (!ppv) return STATUS_INVALID_PARAMETER;

    if (IsEqualGUIDAligned(riid, IID_IUnknown)) {
        *ppv = (PUNKNOWN)(PMINIPORTMIDISTREAM)this;
    } else if (IsEqualGUIDAligned(riid, IID_IMiniportMidiStream)) {
        *ppv = (PMINIPORTMIDISTREAM)this;
    } else {
        *ppv = NULL;
        return STATUS_INVALID_PARAMETER;
    }

    AddRef();
    return STATUS_SUCCESS;
}

STDMETHODIMP_(ULONG) CMiniportMidiStream::AddRef() {
    return InterlockedIncrement(&m_ref);
}

STDMETHODIMP_(ULONG) CMiniportMidiStream::Release() {
    LONG ref = InterlockedDecrement(&m_ref);
    if (ref == 0) {
        this->~CMiniportMidiStream();
        ExFreePool(this);
    }
    return ref;
}

// ============================================================================
// CMiniportMidiStream — IMiniportMidiStream
// ============================================================================

NTSTATUS CMiniportMidiStream::Init(CMiniportMidi* pMiniport, BOOLEAN bCapture) {
    m_pMiniport = pMiniport;
    m_pMiniport->AddRef();
    m_bCapture = bCapture;
    m_state = KSSTATE_STOP;
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidiStream::SetFormat(PKSDATAFORMAT pDataFormat) {
    UNREFERENCED_PARAMETER(pDataFormat);
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidiStream::SetState(KSSTATE State) {
    m_state = State;
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidiStream::Read(
    PVOID   pBuffer,
    ULONG   cbBuffer,
    PULONG  pcbRead
) {
    // Capture stream — read from ring buffer
    if (!m_bCapture || !m_pMiniport || m_state != KSSTATE_RUN) {
        *pcbRead = 0;
        return STATUS_SUCCESS;
    }

    VMIDI_RING* ring = m_pMiniport->GetRingBuffer();
    PUCHAR dst = (PUCHAR)pBuffer;
    ULONG bytesRead = 0;

    while (bytesRead < cbBuffer) {
        LONG rp = ring->readPos;
        LONG wp = ring->writePos;
        if (rp == wp) break; // empty

        VMIDI_EVENT* evt = &ring->events[rp & VMIDI_RING_MASK];

        // KSMUSICFORMAT header + data bytes
        ULONG needed = sizeof(KSMUSICFORMAT) + evt->length;
        needed = (needed + 3) & ~3UL; // align to DWORD
        if (bytesRead + needed > cbBuffer) break;

        PKSMUSICFORMAT pMusic = (PKSMUSICFORMAT)(dst + bytesRead);
        pMusic->TimeDeltaMs = evt->timestamp;
        pMusic->ByteCount = evt->length;

        RtlCopyMemory((PUCHAR)(pMusic + 1), evt->data, evt->length);

        bytesRead += needed;
        InterlockedExchange(&ring->readPos, (rp + 1) & VMIDI_RING_MASK);
    }

    *pcbRead = bytesRead;
    return STATUS_SUCCESS;
}

NTSTATUS CMiniportMidiStream::Write(
    PVOID   pBuffer,
    ULONG   cbWrite,
    PULONG  pcbWritten
) {
    // Render stream — write to ring buffer for loopback to capture
    if (m_bCapture || !m_pMiniport) {
        *pcbWritten = cbWrite;
        return STATUS_SUCCESS;
    }

    VMIDI_RING* ring = m_pMiniport->GetRingBuffer();
    PUCHAR src = (PUCHAR)pBuffer;
    ULONG offset = 0;

    while (offset < cbWrite) {
        if (offset + sizeof(KSMUSICFORMAT) > cbWrite) break;

        PKSMUSICFORMAT pMusic = (PKSMUSICFORMAT)(src + offset);
        ULONG dataSize = pMusic->ByteCount;
        ULONG totalSize = sizeof(KSMUSICFORMAT) + dataSize;
        totalSize = (totalSize + 3) & ~3UL; // DWORD align
        if (offset + totalSize > cbWrite) break;

        // Write event to ring buffer
        LONG wp = ring->writePos;
        LONG nextWp = (wp + 1) & VMIDI_RING_MASK;

        if (nextWp != ring->readPos) {
            VMIDI_EVENT* evt = &ring->events[wp];
            evt->timestamp = pMusic->TimeDeltaMs;
            evt->length = (UCHAR)min(dataSize, (ULONG)4);
            RtlCopyMemory(evt->data, (PUCHAR)(pMusic + 1), evt->length);
            InterlockedExchange(&ring->writePos, nextWp);
        }

        offset += totalSize;
    }

    *pcbWritten = offset;

    // Signal input side that data is available
    m_pMiniport->NotifyInput();

    return STATUS_SUCCESS;
}

// ============================================================================
// Adapter Functions
// ============================================================================

#pragma code_seg("PAGE")
static NTSTATUS StartDevice(
    PDEVICE_OBJECT pDeviceObject,
    PIRP           pIrp,
    PRESOURCELIST  pResourceList
) {
    PAGED_CODE();
    UNREFERENCED_PARAMETER(pResourceList);

    NTSTATUS status;

    // Create a PortMidi port driver
    PPORT pPort = NULL;
    status = PcNewPort(&pPort, CLSID_PortMidi);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    // Create our miniport
    CMiniportMidi* pMiniport = new (NonPagedPoolNx, VMIDI_POOL_TAG) CMiniportMidi();
    if (!pMiniport) {
        pPort->Release();
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    // Initialize port with miniport (binds them together)
    PPORTMIDI pPortMidi = NULL;
    status = pPort->QueryInterface(IID_IPortMidi, (PVOID*)&pPortMidi);
    if (NT_SUCCESS(status)) {
        status = pPortMidi->Init(
            pDeviceObject,
            pIrp,
            (PUNKNOWN)(PMINIPORTMIDI)pMiniport,
            NULL,   // ServiceGroup
            pResourceList
        );
        pPortMidi->Release();
    }

    if (NT_SUCCESS(status)) {
        // Register the subdevice so winmm can see it
        status = PcRegisterSubdevice(
            pDeviceObject,
            L"VirtualMIDI",
            pPort
        );
    }

    pMiniport->Release();
    pPort->Release();

    return status;
}

extern "C" NTSTATUS AddDevice(
    PDRIVER_OBJECT  pDriverObject,
    PDEVICE_OBJECT  pPhysicalDeviceObject
) {
    PAGED_CODE();
    return PcAddAdapterDevice(
        pDriverObject,
        pPhysicalDeviceObject,
        StartDevice,
        1,      // MaxObjects
        0       // DeviceExtensionSize
    );
}
#pragma code_seg()

// ============================================================================
// DriverEntry
// ============================================================================

extern "C" DRIVER_INITIALIZE DriverEntry;

extern "C" NTSTATUS DriverEntry(
    PDRIVER_OBJECT  pDriverObject,
    PUNICODE_STRING pRegistryPathName
) {
    return PcInitializeAdapterDriver(
        pDriverObject,
        pRegistryPathName,
        AddDevice
    );
}
