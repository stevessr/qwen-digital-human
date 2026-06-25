#include "QdhLipSyncDriver.h"
#include "Algo/Find.h"

DEFINE_LOG_CATEGORY_STATIC(LogQdhLipSync, Log, All)

FQdhLipSyncDriver::FQdhLipSyncDriver() {}

void FQdhLipSyncDriver::SetVisemeSequence(const TArray<FVisemeEvent>& Events)
{
    Reset();
    for (const auto& Evt : Events)
    {
        VisemeQueue.Enqueue(Evt);
    }
    bIsPlaying = !Events.IsEmpty();
}

void FQdhLipSyncDriver::SetExpression(const FExpressionFrame& Frame)
{
    TargetExpression = Frame;
}

void FQdhLipSyncDriver::Tick(float DeltaTime)
{
    if (!bIsPlaying || bPaused) return;

    float DeltaMs = DeltaTime * 1000.0f;
    TimelineMs += DeltaMs;

    // Process viseme events that should be active at the current timeline position
    while (!VisemeQueue.IsEmpty())
    {
        FVisemeEvent CurrentViseme;
        VisemeQueue.Peek(CurrentViseme);

        if (TimelineMs >= CurrentViseme.StartMs)
        {
            // This viseme becomes active
            TargetExpression.MouthOpen = CurrentViseme.MouthOpen;
            TargetExpression.JawOpen = CurrentViseme.JawOpen;
            TargetExpression.LipRound = CurrentViseme.LipRound;
            TargetExpression.Smile = CurrentViseme.Smile;
            TargetExpression.Blink = CurrentViseme.Blink;

            if (TimelineMs >= CurrentViseme.EndMs)
            {
                // Viseme has ended; dequeue it
                VisemeQueue.Pop();
            }
            break;
        }
        else
        {
            break;
        }
    }

    // Check if all visemes have been consumed
    if (VisemeQueue.IsEmpty())
    {
        // Return to neutral
        TargetExpression = FExpressionFrame();
        bIsPlaying = false;
    }

    // Blend current toward target
    BlendTowardTarget(DeltaTime);

    ExpressionUpdatedEvent.Broadcast(CurrentExpression);
}

void FQdhLipSyncDriver::SetPaused(bool bPaused)
{
    bPaused = bPaused;
}

void FQdhLipSyncDriver::Reset()
{
    VisemeQueue.Empty();
    CurrentVisemeIndex = 0;
    TimelineMs = 0.0f;
    bIsPlaying = false;
    CurrentExpression = FExpressionFrame();
    TargetExpression = FExpressionFrame();
}

void FQdhLipSyncDriver::BlendTowardTarget(float DeltaTime)
{
    float BlendRate = 1.0f - FMath::Pow(SmoothFactor, DeltaTime * 60.0f);

    auto BlendFloat = [&](float& Current, float Target) {
        Current = FMath::Lerp(Current, Target, BlendRate);
    };

    BlendFloat(CurrentExpression.MouthOpen, TargetExpression.MouthOpen);
    BlendFloat(CurrentExpression.JawOpen, TargetExpression.JawOpen);
    BlendFloat(CurrentExpression.LipRound, TargetExpression.LipRound);
    BlendFloat(CurrentExpression.Smile, TargetExpression.Smile);
    BlendFloat(CurrentExpression.HeadYaw, TargetExpression.HeadYaw);
    BlendFloat(CurrentExpression.HeadPitch, TargetExpression.HeadPitch);
    BlendFloat(CurrentExpression.Blink, TargetExpression.Blink);
}