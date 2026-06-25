#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"
#include "QdhLipSyncDriver.h"

/**
 * Single keyframe in an animation preset.
 * Matches the JSON structure sent by the Python backend.
 */
struct FAnimationKeyframe
{
	float TimeMs = 0.0f;
	float DurationMs = 500.0f;
	float MouthOpen = 0.0f;
	float JawOpen = 0.0f;
	float LipRound = 0.0f;
	float Smile = 0.0f;
	float HeadYaw = 0.0f;
	float HeadPitch = 0.0f;
	float HeadRoll = 0.0f;
	float Blink = 0.0f;
	FString Emotion = TEXT("neutral");
};

/**
 * A named animation preset — a sequence of keyframes with timing.
 */
struct FAnimationPreset
{
	FString Name;
	FString Label;
	TArray<FAnimationKeyframe> Keyframes;
	float DurationMs = 0.0f;
};

/**
 * Animation driver for MetaHuman face rig.
 *
 * Receives animation presets from the backend (e.g., "happy", "thinking",
 * "surprised", "greet") and plays through their timed keyframe sequences,
 * smoothly blending between frames. Designed to work alongside the
 * lip-sync driver to layer emotional animation over viseme-driven speech.
 */
class FQdhAnimationDriver
{
public:
	FQdhAnimationDriver();

	/** Set an animation preset to play. Resets any currently playing animation. */
	void PlayAnimation(const FAnimationPreset& Preset);

	/** Stop the current animation and return to neutral. */
	void StopAnimation();

	/** Advance the animation timeline. Call every tick. */
	void Tick(float DeltaTime);

	/** Returns true if an animation is currently playing. */
	bool IsPlaying() const { return bIsPlaying; }

	/** Returns the current interpolated expression from the animation. */
	FExpressionFrame GetCurrentExpression() const { return CurrentExpression; }

	/** Returns the name of the currently playing animation. */
	FString GetCurrentAnimationName() const { return CurrentPresetName; }

	/** Returns playback progress [0, 1]. */
	float GetProgress() const;

	/** Delegate: fired every tick with the current animation-driven expression. */
	DECLARE_EVENT_OneParam(FQdhAnimationDriver, FOnAnimationExpression, const FExpressionFrame&)
	FOnAnimationExpression& OnAnimationExpression() { return AnimationExpressionEvent; }

	/** Delegate: fired when an animation completes. */
	DECLARE_EVENT_OneParam(FQdhAnimationDriver, FOnAnimationFinished, const FString& /*AnimationName*/)
	FOnAnimationFinished& OnAnimationFinished() { return AnimationFinishedEvent; }

private:
	/** The current animation preset being played. */
	FAnimationPreset CurrentPreset;
	FString CurrentPresetName;

	/** Timeline position in milliseconds. */
	float TimelineMs = 0.0f;

	/** Index of the current keyframe being played. */
	int32 CurrentKeyframeIndex = 0;

	/** Current interpolated expression output. */
	FExpressionFrame CurrentExpression;

	/** Smooth blend to neutral when animation ends. */
	float ReturnToNeutralFactor = 0.08f;

	bool bIsPlaying = false;

	/** Find the two keyframes to blend between at the current timeline position. */
	void GetBlendKeyframes(int32& OutA, int32& OutB, float& OutBlendAlpha) const;

	/** Blend between two keyframes. */
	static FExpressionFrame BlendKeyframes(const FAnimationKeyframe& A, const FAnimationKeyframe& B, float Alpha);

	/** Convert a keyframe to an expression frame. */
	static FExpressionFrame KeyframeToExpression(const FAnimationKeyframe& Kf);

	FOnAnimationExpression AnimationExpressionEvent;
	FOnAnimationFinished AnimationFinishedEvent;
};
