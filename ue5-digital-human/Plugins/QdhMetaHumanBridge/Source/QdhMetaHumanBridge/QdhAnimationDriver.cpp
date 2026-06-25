#include "QdhAnimationDriver.h"

DEFINE_LOG_CATEGORY_STATIC(LogQdhAnimation, Log, All)

FQdhAnimationDriver::FQdhAnimationDriver() {}

void FQdhAnimationDriver::PlayAnimation(const FAnimationPreset& Preset)
{
	if (Preset.Keyframes.IsEmpty())
	{
		UE_LOG(LogQdhAnimation, Warning, TEXT("Attempted to play empty animation '%s'"), *Preset.Name);
		return;
	}

	CurrentPreset = Preset;
	CurrentPresetName = Preset.Name;
	TimelineMs = 0.0f;
	CurrentKeyframeIndex = 0;
	bIsPlaying = true;

	UE_LOG(LogQdhAnimation, Log, TEXT("Playing animation '%s' (%s) — %d keyframes, %.0fms"),
		*Preset.Name, *Preset.Label, Preset.Keyframes.Num(), Preset.DurationMs);

	// Initialize to the first keyframe immediately
	CurrentExpression = KeyframeToExpression(Preset.Keyframes[0]);
}

void FQdhAnimationDriver::StopAnimation()
{
	if (!bIsPlaying) return;

	bIsPlaying = false;
	CurrentPresetName = TEXT("");
	TimelineMs = 0.0f;
	CurrentKeyframeIndex = 0;

	// Blend back to neutral
	CurrentExpression = FExpressionFrame();

	AnimationFinishedEvent.Broadcast(TEXT(""));
}

void FQdhAnimationDriver::Tick(float DeltaTime)
{
	if (!bIsPlaying || CurrentPreset.Keyframes.IsEmpty())
	{
		// Gradual return to neutral if not playing
		if (FMath::Abs(CurrentExpression.MouthOpen) > 0.01f ||
			FMath::Abs(CurrentExpression.Smile) > 0.01f ||
			FMath::Abs(CurrentExpression.HeadYaw) > 0.01f)
		{
			auto LerpToZero = [&](float& Val) {
				Val = FMath::Lerp(Val, 0.0f, ReturnToNeutralFactor);
				if (FMath::Abs(Val) < 0.005f) Val = 0.0f;
			};
			LerpToZero(CurrentExpression.MouthOpen);
			LerpToZero(CurrentExpression.JawOpen);
			LerpToZero(CurrentExpression.LipRound);
			LerpToZero(CurrentExpression.Smile);
			LerpToZero(CurrentExpression.HeadYaw);
			LerpToZero(CurrentExpression.HeadPitch);
			LerpToZero(CurrentExpression.HeadRoll);
			LerpToZero(CurrentExpression.Blink);
			AnimationExpressionEvent.Broadcast(CurrentExpression);
		}
		return;
	}

	float DeltaMs = DeltaTime * 1000.0f;
	TimelineMs += DeltaMs;

	// Check if the current keyframe has ended
	bool bFinished = false;
	while (CurrentKeyframeIndex < CurrentPreset.Keyframes.Num())
	{
		const auto& Kf = CurrentPreset.Keyframes[CurrentKeyframeIndex];
		float KfEndMs = Kf.TimeMs + Kf.DurationMs;

		if (TimelineMs >= KfEndMs)
		{
			// Advance to the next keyframe
			CurrentKeyframeIndex++;
			if (CurrentKeyframeIndex >= CurrentPreset.Keyframes.Num())
			{
				// Animation complete
				bFinished = true;
				break;
			}
		}
		else
		{
			break;
		}
	}

	if (bFinished)
	{
		FString FinishedName = CurrentPresetName;
		StopAnimation();
		AnimationFinishedEvent.Broadcast(FinishedName);
		return;
	}

	// Blend between current and next keyframe
	int32 IdxA, IdxB;
	float BlendAlpha;
	GetBlendKeyframes(IdxA, IdxB, BlendAlpha);

	const auto& KfA = CurrentPreset.Keyframes[IdxA];
	const auto& KfB = CurrentPreset.Keyframes[IdxB];

	CurrentExpression = BlendKeyframes(KfA, KfB, BlendAlpha);

	AnimationExpressionEvent.Broadcast(CurrentExpression);
}

float FQdhAnimationDriver::GetProgress() const
{
	if (!bIsPlaying || CurrentPreset.DurationMs <= 0.0f) return 0.0f;
	return FMath::Clamp(TimelineMs / CurrentPreset.DurationMs, 0.0f, 1.0f);
}

void FQdhAnimationDriver::GetBlendKeyframes(int32& OutA, int32& OutB, float& OutBlendAlpha) const
{
	int32 NumKfs = CurrentPreset.Keyframes.Num();
	if (NumKfs == 0)
	{
		OutA = OutB = 0;
		OutBlendAlpha = 0.0f;
		return;
	}

	OutA = FMath::Clamp(CurrentKeyframeIndex, 0, NumKfs - 1);
	OutB = FMath::Clamp(CurrentKeyframeIndex + 1, 0, NumKfs - 1);

	const auto& KfA = CurrentPreset.Keyframes[OutA];
	float KfEndMs = KfA.TimeMs + KfA.DurationMs;

	if (KfA.DurationMs > 0.0f)
	{
		OutBlendAlpha = FMath::Clamp((TimelineMs - KfA.TimeMs) / KfA.DurationMs, 0.0f, 1.0f);
	}
	else
	{
		OutBlendAlpha = 1.0f;
	}
}

FExpressionFrame FQdhAnimationDriver::BlendKeyframes(const FAnimationKeyframe& A, const FAnimationKeyframe& B, float Alpha)
{
	FExpressionFrame Result;
	Result.MouthOpen = FMath::Lerp(A.MouthOpen, B.MouthOpen, Alpha);
	Result.JawOpen = FMath::Lerp(A.JawOpen, B.JawOpen, Alpha);
	Result.LipRound = FMath::Lerp(A.LipRound, B.LipRound, Alpha);
	Result.Smile = FMath::Lerp(A.Smile, B.Smile, Alpha);
	Result.HeadYaw = FMath::Lerp(A.HeadYaw, B.HeadYaw, Alpha);
	Result.HeadPitch = FMath::Lerp(A.HeadPitch, B.HeadPitch, Alpha);
	Result.HeadRoll = FMath::Lerp(A.HeadRoll, B.HeadRoll, Alpha);
	Result.Blink = FMath::Lerp(A.Blink, B.Blink, Alpha);
	Result.Emotion = Alpha < 0.5f ? A.Emotion : B.Emotion;
	return Result;
}

FExpressionFrame FQdhAnimationDriver::KeyframeToExpression(const FAnimationKeyframe& Kf)
{
	FExpressionFrame Result;
	Result.MouthOpen = Kf.MouthOpen;
	Result.JawOpen = Kf.JawOpen;
	Result.LipRound = Kf.LipRound;
	Result.Smile = Kf.Smile;
	Result.HeadYaw = Kf.HeadYaw;
	Result.HeadPitch = Kf.HeadPitch;
	Result.HeadRoll = Kf.HeadRoll;
	Result.Blink = Kf.Blink;
	Result.Emotion = Kf.Emotion;
	return Result;
}
