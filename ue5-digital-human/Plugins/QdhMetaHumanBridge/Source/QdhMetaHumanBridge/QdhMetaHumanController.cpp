#include "QdhMetaHumanController.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/World.h"

DEFINE_LOG_CATEGORY_STATIC(LogQdhController, Log, All)

AQdhMetaHumanController::AQdhMetaHumanController()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 0.016f; // ~60 FPS
}

void AQdhMetaHumanController::BeginPlay()
{
    Super::BeginPlay();

    // Initialize components
    WsClient = MakeUnique<FQdhWebSocketClient>();
    AudioPlayer = MakeUnique<FQdhAudioPlayer>();
    LipSyncDriver = MakeUnique<FQdhLipSyncDriver>();

    // Wire up WebSocket events
    WsClient->OnJsonMessage().AddRaw(this, &AQdhMetaHumanController::OnWsJsonMessage);
    WsClient->OnBinaryMessage().AddRaw(this, &AQdhMetaHumanController::OnWsBinaryMessage);
    WsClient->OnConnectionState().AddRaw(this, &AQdhMetaHumanController::OnWsConnectionState);

    // Wire up lip-sync driver to emit expression updates to Blueprint
    LipSyncDriver->OnExpressionUpdated().AddLambda([this](const FExpressionFrame& Frame) {
        bAudioPlaying = LipSyncDriver->IsPlaying();
        OnExpressionUpdated(
            Frame.Emotion,
            Frame.MouthOpen,
            Frame.JawOpen,
            Frame.LipRound,
            Frame.Smile,
            Frame.Blink
        );
    });

    // Initialize audio player
    AudioPlayer->Initialize(GetWorld(), AudioSampleRate);
    AudioPlayer->SetVolume(AudioVolume);

    // Auto-connect
    ConnectToBackend();
}

void AQdhMetaHumanController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    DisconnectFromBackend();
    AudioPlayer->Stop();
    Super::EndPlay(EndPlayReason);
}

void AQdhMetaHumanController::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (WsClient)
    {
        WsClient->Tick(DeltaTime);
    }
    if (LipSyncDriver)
    {
        LipSyncDriver->Tick(DeltaTime);
    }
}

void AQdhMetaHumanController::ConnectToBackend()
{
    if (WsClient)
    {
        WsClient->Connect(BackendWsUrl);
    }
}

void AQdhMetaHumanController::DisconnectFromBackend()
{
    if (WsClient)
    {
        WsClient->Disconnect();
    }
    ConnectionStatus = TEXT("Disconnected");
    bBackendConnected = false;
    OnBackendConnectionStateChanged(false);
}

void AQdhMetaHumanController::SendTestExpression()
{
    if (WsClient && WsClient->IsConnected())
    {
        FString TestJson = TEXT("{\"type\":\"expression\",\"data\":{\"mouth_open\":0.5,\"smile\":0.8,\"blink\":0.0}}");
        WsClient->SendJson(TestJson);
        UE_LOG(LogQdhController, Log, TEXT("Sent test expression"));
    }
}

void AQdhMetaHumanController::ApplyExpression(
    float MouthOpen, float JawOpen, float LipRound,
    float Smile, float Blink, float HeadYaw, float HeadPitch)
{
    FExpressionFrame Frame;
    Frame.MouthOpen = MouthOpen;
    Frame.JawOpen = JawOpen;
    Frame.LipRound = LipRound;
    Frame.Smile = Smile;
    Frame.Blink = Blink;
    Frame.HeadYaw = HeadYaw;
    Frame.HeadPitch = HeadPitch;

    if (LipSyncDriver)
    {
        LipSyncDriver->SetExpression(Frame);
    }
}

// ==========================================================================
// WebSocket event handlers
// ==========================================================================

void AQdhMetaHumanController::OnWsJsonMessage(const FString& Json)
{
    TSharedPtr<FJsonObject> JsonObject;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);

    if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
    {
        UE_LOG(LogQdhController, Warning, TEXT("Failed to parse JSON from backend: %s"), *Json);
        return;
    }

    FString MessageType = JsonObject->GetStringField(TEXT("type"));

    if (MessageType == TEXT("expression"))
    {
        HandleExpressionMessage(JsonObject);
    }
    else if (MessageType == TEXT("viseme_sequence"))
    {
        HandleVisemeSequenceMessage(JsonObject);
    }
    else if (MessageType == TEXT("tts_complete"))
    {
        HandleTtsCompleteMessage(JsonObject);
    }
    else if (MessageType == TEXT("text_chunk"))
    {
        HandleTextChunkMessage(JsonObject);
    }
    else if (MessageType == TEXT("text"))
    {
        HandleTextMessage(JsonObject);
    }
    else if (MessageType == TEXT("ping"))
    {
        // Respond with pong
        if (WsClient) WsClient->SendJson(TEXT("{\"type\":\"pong\"}"));
    }
    else if (MessageType == TEXT("handshake"))
    {
        WsClient->SendJson(TEXT("{\"type\":\"ready\"}"));
    }
    else if (MessageType == TEXT("status"))
    {
        FString Status = JsonObject->GetStringField(TEXT("status"));
        ConnectionStatus = Status;
        OnBackendLog(Status);
    }
}

void AQdhMetaHumanController::OnWsBinaryMessage(const TArray<uint8>& Data, int32 Size)
{
    if (Size < 9) return;  // Minimum: frame type (1) + sample rate (4) + pcm length (4) = 9

    // Binary frame format:
    //   [0] = frame type (0xB2 = audio)
    //   [1-4] = sample_rate (uint32 LE)
    //   [5-8] = pcm_length (uint32 LE)
    //   [9..] = PCM16LE data

    uint8 FrameType = Data[0];
    if (FrameType != 0xB2) return;

    int32 SampleRate = *reinterpret_cast<const int32*>(Data.GetData() + 1);
    int32 PcmLength = *reinterpret_cast<const int32*>(Data.GetData() + 5);
    int32 HeaderSize = 9;

    if (PcmLength > 0 && Data.Num() >= HeaderSize + PcmLength)
    {
        TArray<uint8> PcmData(Data.GetData() + HeaderSize, PcmLength);

        // Enqueue for audio playback
        if (AudioPlayer)
        {
            AudioPlayer->EnqueuePcmData(PcmData, SampleRate);
        }
    }
}

void AQdhMetaHumanController::OnWsConnectionState(bool bConnected)
{
    bBackendConnected = bConnected;
    ConnectionStatus = bConnected ? TEXT("Connected") : TEXT("Disconnected");
    OnBackendConnectionStateChanged(bConnected);
}

void AQdhMetaHumanController::HandleExpressionMessage(const TSharedPtr<FJsonObject>& Json)
{
    const TSharedPtr<FJsonObject>* DataPtr = nullptr;
    if (!Json->TryGetObjectField(TEXT("data"), DataPtr)) return;

    const TSharedPtr<FJsonObject>& Data = *DataPtr;

    FExpressionFrame Frame;
    Frame.MouthOpen = Data->GetNumberField(TEXT("mouth_open"));
    Frame.JawOpen = Data->GetNumberField(TEXT("jaw_open"));
    Frame.LipRound = Data->GetNumberField(TEXT("lip_round"));
    Frame.Smile = Data->GetNumberField(TEXT("smile"));
    Frame.Blink = Data->GetNumberField(TEXT("blink"));
    Frame.HeadYaw = Data->GetNumberField(TEXT("head_yaw"));
    Frame.HeadPitch = Data->GetNumberField(TEXT("head_pitch"));
    Frame.Emotion = Data->GetStringField(TEXT("emotion"));

    if (LipSyncDriver)
    {
        LipSyncDriver->SetExpression(Frame);
    }
}

void AQdhMetaHumanController::HandleVisemeSequenceMessage(const TSharedPtr<FJsonObject>& Json)
{
    const TArray<TSharedPtr<FJsonValue>>* DataArray = nullptr;
    if (!Json->TryGetArrayField(TEXT("data"), DataArray)) return;

    TArray<FVisemeEvent> Events;
    for (const auto& Val : *DataArray)
    {
        const TSharedPtr<FJsonObject>* ItemPtr = nullptr;
        if (!Val->TryGetObject(ItemPtr)) continue;

        const TSharedPtr<FJsonObject>& Item = *ItemPtr;
        FVisemeEvent Evt;
        Evt.VisemeId = Item->GetStringField(TEXT("viseme"));
        Evt.StartMs = Item->GetNumberField(TEXT("start_ms"));
        Evt.MouthOpen = Item->GetNumberField(TEXT("mouth_open"));
        Evt.JawOpen = Item->GetNumberField(TEXT("jaw_open"));
        Evt.LipRound = Item->GetNumberField(TEXT("lip_round"));
        Evt.Smile = Item->GetNumberField(TEXT("smile"));
        Evt.Blink = Item->GetNumberField(TEXT("blink"));

        // Use end_ms from backend if available, otherwise estimate 40ms frame
        double EndMsValue = 0.0;
        if (Item->TryGetNumberField(TEXT("end_ms"), EndMsValue))
        {
            Evt.EndMs = EndMsValue;
        }
        else
        {
            Evt.EndMs = Evt.StartMs + 40.0f;
        }

        Events.Add(Evt);
    }

    if (LipSyncDriver)
    {
        LipSyncDriver->SetVisemeSequence(Events);
    }
}

void AQdhMetaHumanController::HandleTtsCompleteMessage(const TSharedPtr<FJsonObject>& Json)
{
    // Extract text and duration for subtitle timing
    FString Text = Json->GetStringField(TEXT("text"));
    float DurationMs = Json->GetNumberField(TEXT("duration_ms"));

    if (!Text.IsEmpty())
    {
        ReceivedText = Text;
        SubtitleText = Text;
        OnTranscriptReceived(Text);
    }

    // Start audio playback
    if (AudioPlayer)
    {
        AudioPlayer->Play();
    }
}

void AQdhMetaHumanController::HandleTextChunkMessage(const TSharedPtr<FJsonObject>& Json)
{
    FString ChunkText = Json->GetStringField(TEXT("data"));
    bool bFinal = Json->GetBoolField(TEXT("final"));

    if (ChunkText.IsEmpty()) return;

    // Append to subtitle text
    SubtitleText += ChunkText.TrimStart();

    // Keep the last received text as the current display
    ReceivedText = ChunkText;

    // Fire event for blueprints (subtitle display, etc.)
    OnTextReceived(ChunkText, bFinal);

    if (bFinal)
    {
        // Signal the lip-sync driver that text streaming is done
        // (Blueprint can use OnTextReceived(bFinal=true) to finalize subtitle display)
        OnTranscriptReceived(SubtitleText);
    }
}

void AQdhMetaHumanController::HandleTextMessage(const TSharedPtr<FJsonObject>& Json)
{
    FString Text = Json->GetStringField(TEXT("data"));

    if (Text.IsEmpty()) return;

    // Set as the current transcript
    ReceivedText = Text;
    SubtitleText = Text;

    // Fire events for blueprints
    OnTextReceived(Text, /*bFinal=*/true);
    OnTranscriptReceived(Text);
}