#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "QdhMetaHumanController.generated.h"

/**
 * Game mode for QDH MetaHuman.
 *
 * Sets the default player controller to AQdhMetaHumanController
 * which manages the WebSocket, audio, and lip-sync integration.
 */
UCLASS(BlueprintType, Blueprintable)
class QDHMETAHUMANBRIDGE_API AQdhMetaHumanGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AQdhMetaHumanGameMode()
    {
        PlayerControllerClass = AQdhMetaHumanController::StaticClass();
        DefaultPawnClass = nullptr;
    }
};