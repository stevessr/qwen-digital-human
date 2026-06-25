#pragma once

#include "CoreMinimal.h"
#include "Sound/SoundWaveProcedural.h"
#include "Components/AudioComponent.h"
#include "Containers/Queue.h"

/**
 * Real-time PCM audio player for streaming audio from WebSocket.
 *
 * Receives PCM16LE mono chunks and plays them through a procedural
 * Sound Wave. Supports queuing, sample-rate conversion, and pause/resume.
 */
class FQdhAudioPlayer
{
public:
    FQdhAudioPlayer();
    ~FQdhAudioPlayer();

    /** Initialize the audio player with an owning world and desired sample rate. */
    void Initialize(UWorld* World, int32 SampleRate = 24000);

    /** Enqueue PCM16LE mono audio data for playback. */
    void EnqueuePcmData(const TArray<uint8>& PcmData, int32 SourceSampleRate);

    /** Start or resume playback. */
    void Play();

    /** Pause playback. */
    void Pause();

    /** Stop and flush all queued audio. */
    void Stop();

    /** Set playback volume (0.0–1.0). */
    void SetVolume(float Volume);

    /** Returns true if currently playing. */
    bool IsPlaying() const;

    /** Returns the number of queued PCM chunks. */
    int32 GetQueuedChunkCount() const;

private:
    /** Procedural sound wave that the AudioComponent plays. */
    UPROPERTY()
    USoundWaveProcedural* SoundWave = nullptr;

    /** Audio component used for playback. */
    UPROPERTY()
    UAudioComponent* AudioComponent = nullptr;

    /** Queue of PCM16LE chunks waiting to be consumed. */
    TQueue<TArray<uint8>> PcmQueue;

    /** Current offset into the active PCM chunk. */
    int32 CurrentChunkOffset = 0;

    /** Target sample rate for playback (AudioMixer). */
    int32 TargetSampleRate = 24000;

    /** Mutex for thread-safe queue access. */
    FCriticalSection QueueCriticalSection;

    /** Internal: generate PCM samples into the procedural sound wave buffer. */
    void GeneratePcmCallback(TArray<uint8>& OutAudio);

    float Volume = 1.0f;
    bool bIsPlaying = false;
};