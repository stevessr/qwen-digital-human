#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"

/**
 * Lip-sync driver for MetaHuman face rig.
 *
 * Receives viseme sequences and expression frames from the backend
 * and drives the MetaHuman blueprint's exposed face-control parameters
 * via smooth interpolation.
 */

struct FVisemeEvent
{
    FString VisemeId;
    float StartMs = 0.0f;
    float EndMs = 0.0f;
    float MouthOpen = 0.0f;
    float JawOpen = 0.0f;
    float LipRound = 0.0f;
    float Smile = 0.0f;
    float Blink = 0.0f;
};

struct FExpressionFrame
{
    float MouthOpen = 0.0f;
    float JawOpen = 0.0f;
    float LipRound = 0.0f;
    float Smile = 0.0f;
    float HeadYaw = 0.0f;
    float HeadPitch = 0.0f;
    float Blink = 0.0f;
    FString Emotion = TEXT("neutral");
};

class FQdhLipSyncDriver
{
public:
    FQdhLipSyncDriver();

    /** Set the current viseme sequence to drive playback. */
    void SetVisemeSequence(const TArray<FVisemeEvent>& Events);

    /** Set a single expression frame (instant or target). */
    void SetExpression(const FExpressionFrame& Frame);

    /** Advance the timeline. Call every tick with the delta time. */
    void Tick(float DeltaTime);

    /** Pause/resume timeline playback. */
    void SetPaused(bool bPaused);

    /** Reset the timeline and clear all pending events. */
    void Reset();

    /** Returns the current interpolated expression parameters. */
    FExpressionFrame GetCurrentExpression() const { return CurrentExpression; }

    /** Returns true if the timeline is actively playing. */
    bool IsPlaying() const { return bIsPlaying; }

    /** Delegate: fired every tick with the latest expression values. */
    DECLARE_EVENT_OneParam(FQdhLipSyncDriver, FOnExpressionUpdated, const FExpressionFrame&)
    FOnExpressionUpdated& OnExpressionUpdated() { return ExpressionUpdatedEvent; }

private:
    /** Current expression being interpolated toward. */
    FExpressionFrame CurrentExpression;
    FExpressionFrame TargetExpression;

    /** Queue of viseme events from the backend. */
    TQueue<FVisemeEvent> VisemeQueue;

    /** Current viseme being played back. */
    int32 CurrentVisemeIndex = 0;

    /** Playback timeline in milliseconds. */
    float TimelineMs = 0.0f;

    /** Smoothing factor (0.0 = instant, 1.0 = very smooth). */
    float SmoothFactor = 0.75f;

    bool bIsPlaying = false;
    bool bPaused = false;

    /** Interpolate current toward target with smoothing. */
    void BlendTowardTarget(float DeltaTime);

    FOnExpressionUpdated ExpressionUpdatedEvent;
};