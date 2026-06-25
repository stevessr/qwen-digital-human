#include "QdhAudioPlayer.h"
#include "AudioDevice.h"
#include "Engine/World.h"

DEFINE_LOG_CATEGORY_STATIC(LogQdhAudio, Log, All)

FQdhAudioPlayer::FQdhAudioPlayer() {}

FQdhAudioPlayer::~FQdhAudioPlayer()
{
    Stop();
}

void FQdhAudioPlayer::Initialize(UWorld* World, int32 SampleRate)
{
    TargetSampleRate = SampleRate;

    if (!SoundWave)
    {
        SoundWave = NewObject<USoundWaveProcedural>();
        SoundWave->SetSampleRate(TargetSampleRate);
        SoundWave->NumChannels = 1;
        SoundWave->Duration = INDEFINITELY_LOOPING_DURATION;
        SoundWave->SoundGroup = SOUNDGROUP_Voice;
        SoundWave->bLooping = false;
    }

    if (!AudioComponent && World)
    {
        AudioComponent = UAudioComponent::CreateAudioComponent(World, World->GetAudioDevice());
        if (AudioComponent)
        {
            AudioComponent->SetSound(SoundWave);
            AudioComponent->bAutoActivate = false;
            AudioComponent->SetVolumeMultiplier(Volume);
        }
    }
}

void FQdhAudioPlayer::EnqueuePcmData(const TArray<uint8>& PcmData, int32 SourceSampleRate)
{
    FScopeLock Lock(&QueueCriticalSection);

    // Simple sample-rate conversion via linear interpolation
    TArray<uint8> Converted;
    if (SourceSampleRate != TargetSampleRate && SourceSampleRate > 0)
    {
        int32 SourceSamples = PcmData.Num() / 2;
        int32 TargetSamples = FMath::CeilToInt(SourceSamples * (float)TargetSampleRate / (float)SourceSampleRate);
        Converted.SetNumUninitialized(TargetSamples * 2);

        float Ratio = (float)SourceSampleRate / (float)TargetSampleRate;
        for (int32 i = 0; i < TargetSamples; i++)
        {
            float SrcPos = i * Ratio;
            int32 SrcIdx = FMath::FloorToInt(SrcPos);
            float Frac = SrcPos - SrcIdx;
            SrcIdx = FMath::Clamp(SrcIdx, 0, SourceSamples - 1);
            int32 NextIdx = FMath::Min(SrcIdx + 1, SourceSamples - 1);

            int16 S0 = *reinterpret_cast<const int16*>(PcmData.GetData() + SrcIdx * 2);
            int16 S1 = *reinterpret_cast<const int16*>(PcmData.GetData() + NextIdx * 2);
            int16 Sample = FMath::Lerp(S0, S1, Frac);

            FMemory::Memcpy(Converted.GetData() + i * 2, &Sample, 2);
        }
        PcmQueue.Enqueue(MoveTemp(Converted));
    }
    else
    {
        PcmQueue.Enqueue(PcmData);
    }

    // Notify the procedural sound wave that new data is available
    if (SoundWave)
    {
        SoundWave->QueueAudio(PcmData);
    }
}

void FQdhAudioPlayer::Play()
{
    if (AudioComponent && !AudioComponent->IsPlaying())
    {
        AudioComponent->Play();
        bIsPlaying = true;
    }
}

void FQdhAudioPlayer::Pause()
{
    if (AudioComponent && AudioComponent->IsPlaying())
    {
        AudioComponent->Stop();
        bIsPlaying = false;
    }
}

void FQdhAudioPlayer::Stop()
{
    Pause();
    FScopeLock Lock(&QueueCriticalSection);
    PcmQueue.Empty();
    CurrentChunkOffset = 0;
    if (SoundWave)
    {
        SoundWave->ResetAudio();
    }
}

void FQdhAudioPlayer::SetVolume(float NewVolume)
{
    Volume = FMath::Clamp(NewVolume, 0.0f, 1.0f);
    if (AudioComponent)
    {
        AudioComponent->SetVolumeMultiplier(Volume);
    }
}

bool FQdhAudioPlayer::IsPlaying() const
{
    return bIsPlaying && AudioComponent && AudioComponent->IsPlaying();
}

int32 FQdhAudioPlayer::GetQueuedChunkCount() const
{
    return PcmQueue.GetAllocatedSize();
}