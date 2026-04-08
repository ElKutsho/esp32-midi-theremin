/*
 * vmidi_km.h — Virtual MIDI Kernel-Mode Driver Header
 *
 * Minimal PortCls MIDI miniport driver that creates virtual MIDI
 * input/output port pairs with internal loopback.
 */

#pragma once

extern "C" {
#include <ntddk.h>
#include <initguid.h>    // Must come before portcls.h to define GUIDs
#include <portcls.h>
#include <ksdebug.h>
}

// Pool tag
#define VMIDI_POOL_TAG 'idiV'

// Ring buffer
#define VMIDI_RING_SIZE 1024
#define VMIDI_RING_MASK (VMIDI_RING_SIZE - 1)

struct VMIDI_EVENT {
    ULONG  timestamp;
    UCHAR  data[4];
    UCHAR  length;
};

struct VMIDI_RING {
    volatile LONG  writePos;
    volatile LONG  readPos;
    VMIDI_EVENT    events[VMIDI_RING_SIZE];
};

// Forward declarations
class CMiniportMidiStream;

// ============================================================================
// CMiniportMidi — IMiniportMidi implementation
// ============================================================================

class CMiniportMidi : public IMiniportMidi {
public:
    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, PVOID* ppv);
    STDMETHODIMP_(ULONG) AddRef();
    STDMETHODIMP_(ULONG) Release();

    // IMiniportMidi
    STDMETHODIMP_(NTSTATUS) Init(
        IN PUNKNOWN        pUnknownAdapter,
        IN PRESOURCELIST   pResourceList,
        IN PPORTMIDI       pPort,
        OUT PSERVICEGROUP* ppServiceGroup
    );

    STDMETHODIMP_(NTSTATUS) NewStream(
        OUT PMINIPORTMIDISTREAM* ppStream,
        IN  PUNKNOWN             pOuterUnknown,
        IN  POOL_TYPE            PoolType,
        IN  ULONG                uPin,
        IN  BOOLEAN              bCapture,
        IN  PKSDATAFORMAT        pDataFormat,
        OUT PSERVICEGROUP*       ppServiceGroup
    );

    STDMETHODIMP_(void) Service();
    STDMETHODIMP_(NTSTATUS) GetDescription(OUT PPCFILTER_DESCRIPTOR* ppFilterDescriptor);

    STDMETHODIMP_(NTSTATUS) DataRangeIntersection(
        IN  ULONG        PinId,
        IN  PKSDATARANGE DataRange,
        IN  PKSDATARANGE MatchingDataRange,
        IN  ULONG        OutputBufferLength,
        OUT PVOID        ResultantFormat OPTIONAL,
        OUT PULONG       ResultantFormatLength
    );

    // Helpers
    VMIDI_RING* GetRingBuffer() { return &m_ring; }
    void NotifyInput();

    // Construction
    CMiniportMidi();
    ~CMiniportMidi();

    friend class CMiniportMidiStream;

private:
    LONG           m_ref;
    PPORTMIDI      m_pPort;
    VMIDI_RING     m_ring;
    CMiniportMidiStream* m_pCaptureStream;
};

// ============================================================================
// CMiniportMidiStream — IMiniportMidiStream implementation
// ============================================================================

class CMiniportMidiStream : public IMiniportMidiStream {
public:
    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, PVOID* ppv);
    STDMETHODIMP_(ULONG) AddRef();
    STDMETHODIMP_(ULONG) Release();

    // IMiniportMidiStream
    STDMETHODIMP_(NTSTATUS) SetFormat(IN PKSDATAFORMAT pDataFormat);
    STDMETHODIMP_(NTSTATUS) SetState(IN KSSTATE State);
    STDMETHODIMP_(NTSTATUS) Read(IN PVOID pBuffer, IN ULONG cbBuffer, OUT PULONG pcbRead);
    STDMETHODIMP_(NTSTATUS) Write(IN PVOID pBuffer, IN ULONG cbWrite, OUT PULONG pcbWritten);

    // Construction
    CMiniportMidiStream();
    ~CMiniportMidiStream();
    NTSTATUS Init(CMiniportMidi* pMiniport, BOOLEAN bCapture);

private:
    LONG           m_ref;
    CMiniportMidi* m_pMiniport;
    BOOLEAN        m_bCapture;
    KSSTATE        m_state;
};

// Kernel operator new/delete for our classes
void* __cdecl operator new(size_t size, POOL_TYPE poolType, ULONG tag);
void  __cdecl operator delete(void* p, size_t size);
