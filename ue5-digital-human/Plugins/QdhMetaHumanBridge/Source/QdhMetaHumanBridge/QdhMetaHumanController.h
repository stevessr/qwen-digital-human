#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "QdhWebSocketClient.h"
#include "QdhAudioPlayer.h"
#include "QdhLipSyncDriver.h"
#include "QdhMetaHumanController.generated.h"

/**
 * Main controller for QDH MetaHuman integration.
 *
 * Coordinates the WebSocket client, audio player, and lip-sync driver
 * to create a real-time digital human driven by the Python backend.
 *
 * BP_QdhMetaHumanController is the blueprint parent for this class.
 */
UCLASS(BlueprintType, Blueprintable)
class QDHMETAHUMANBRIDGE_API AQdhMetaHumanController : public APlayerController
{
    GENERATED_BODY()

public:
    AQdhMetaHumanController();

    // ======================================================================
    // Configuration
    // ======================================================================

    /** Backend WebSocket URL (default: ws://127.0.0.1:3000/api/ws/ue5) */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QDH|Connection")
    FString BackendWsUrl = TEXT("ws://127.0.0.1:3000/api/ws/ue5");

    /** Audio sample rate for PCM playback. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QDH|Audio")
    int32 AudioSampleRate = 24000;

    /** Audio playback volume (0.0–1.0). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QDH|Audio")
    float AudioVolume = 1.0f;

    // ======================================================================
    // Blueprint-accessible state
    // ======================================================================

    /** Connection status string (for UI display). */
    UPROPERTY(BlueprintReadOnly, Category = "QDH|Status")
    FString ConnectionStatus = TEXT("Disconnected");

    /** True when the WebSocket is connected. */
    UPROPERTY(BlueprintReadOnly, Category = "QDH|Status")
    bool bBackendConnected = false;

    /** True when audio is currently playing. */
    UPROPERTY(BlueprintReadOnly, Category = "QDH|Status")
    bool bAudioPlaying = false;

    /** Latest received text from the LLM (for subtitle display). */
    UPROPERTY(BlueprintReadOnly, Category = "QDH|Text")
    FString ReceivedText = TEXT("");

    /** Accumulated subtitle text from streaming chunks. */
    UPROPERTY(BlueprintReadOnly, Category = "QDH|Text")
    FString SubtitleText = TEXT("");

    // ======================================================================
    // Blueprint-callable API
    // ======================================================================

    /** Connect to the QDH backend. */
    UFUNCTION(BlueprintCallable, Category = "QDH|Connection")
    void ConnectToBackend();

    /** Disconnect from the QDH backend. */
    UFUNCTION(BlueprintCallable, Category = "QDH|Connection")
    void DisconnectFromBackend();

    /** Send a test expression to the backend. */
    UFUNCTION(BlueprintCallable, Category = "QDH|Debug")
    void SendTestExpression();

    /** Apply the current expression to the MetaHuman face rig. */
    UFUNCTION(BlueprintCallable, Category = "QDH|Expression")
    void ApplyExpression(float MouthOpen, float JawOpen, float LipRound, float Smile, float Blink, float HeadYaw, float HeadPitch);

    // ======================================================================
    // Events (Blueprint implementable)
    // ======================================================================

    /** Called when a new expression frame is computed. */
    UFUNCTION(BlueprintImplementableEvent, Category = "QDH|Expression")
    void OnExpressionUpdated(const FString& Emotion, float MouthOpen, float JawOpen, float LipRound, float Smile, float Blink);

    /** Called when connection state changes. */
    UFUNCTION(BlueprintImplementableEvent, Category = "QDH|Connection")
    void OnBackendConnectionStateChanged(bool bConnected);

    /** Called when a log message arrives from the backend. */
    UFUNCTION(BlueprintImplementableEvent, Category = "QDH|Connection")
    void OnBackendLog(const FString& Message);

    /** Called when a text chunk arrives from the LLM stream (for subtitles). */
    UFUNCTION(BlueprintImplementableEvent, Category = "QDH|Text")
    void OnTextReceived(const FString& Text, bool bFinal);

    /** Called when the final cleaned transcript arrives. */
    UFUNCTION(BlueprintImplementableEvent, Category = "QDH|Text")
    void OnTranscriptReceived(const FString& Transcript);

protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    virtual void Tick(float DeltaTime) override;

private:
    // Core components
    TUniquePtr<FQdhWebSocketClient> WsClient;
    TUniquePtr<FQdhAudioPlayer> AudioPlayer;
    TUniquePtr<FQdhLipSyncDriver> LipSyncDriver;

    /** Handlers for WebSocket events. */
    void OnWsJsonMessage(const FString& Json);
    void OnWsBinaryMessage(const TArray<uint8>& Data, int32 Size);
    void OnWsConnectionState(bool bConnected);

    /** Parse a JSON expression message. */
    void HandleExpressionMessage(const TSharedPtr<FJsonObject>& Json);

    /** Parse a JSON viseme_sequence message. */
    void HandleVisemeSequenceMessage(const TSharedPtr<FJsonObject>& Json);

    /** Parse a JSON tts_complete message. */
    void HandleTtsCompleteMessage(const TSharedPtr<FJsonObject>& Json);

    /** Parse a JSON text_chunk message (real-time LLM delta). */
    void HandleTextChunkMessage(const TSharedPtr<FJsonObject>& Json);

    /** Parse a JSON text message (final transcript). */
    void HandleTextMessage(const TSharedPtr<FJsonObject>& Json);
};