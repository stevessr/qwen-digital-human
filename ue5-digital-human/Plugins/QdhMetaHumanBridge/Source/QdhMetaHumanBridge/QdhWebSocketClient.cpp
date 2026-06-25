#include "QdhWebSocketClient.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"

DEFINE_LOG_CATEGORY_STATIC(LogQdhWs, Log, All)

void FQdhWebSocketClient::Connect(const FString& Url)
{
    ServerUrl = Url;
    ReconnectAttempts = 0;

    if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
    {
        FModuleManager::Get().LoadModuleChecked("WebSockets");
    }

    Socket = FWebSocketsModule::Get().CreateWebSocket(Url);

    Socket->OnConnected().AddRaw(this, &FQdhWebSocketClient::HandleConnected);
    Socket->OnConnectionError().AddLambda([this](const FString& Error) {
        UE_LOG(LogQdhWs, Error, TEXT("WebSocket connection error: %s"), *Error);
        bConnected = false;
        ConnectionStateEvent.Broadcast(false);
        DisconnectedEvent.Broadcast();
        ScheduleReconnect();
    });
    Socket->OnClosed().AddRaw(this, &FQdhWebSocketClient::HandleDisconnected);
    Socket->OnMessage().AddRaw(this, &FQdhWebSocketClient::HandleMessage);
    Socket->OnRawMessage().AddRaw(this, &FQdhWebSocketClient::HandleRawMessage);

    Socket->Connect();
    UE_LOG(LogQdhWs, Log, TEXT("Connecting to %s"), *Url);
}

void FQdhWebSocketClient::Disconnect()
{
    if (Socket.IsValid() && bConnected)
    {
        Socket->Close();
    }
    bConnected = false;
    Socket.Reset();

    if (ReconnectTimerHandle.IsValid())
    {
        FTimerManager* TimerManager = &GWorld->GetTimerManager();
        if (TimerManager) TimerManager->ClearTimer(ReconnectTimerHandle);
    }
}

bool FQdhWebSocketClient::IsConnected() const
{
    return bConnected;
}

bool FQdhWebSocketClient::SendJson(const FString& JsonString)
{
    if (!Socket.IsValid() || !bConnected) return false;
    Socket->Send(JsonString);
    return true;
}

bool FQdhWebSocketClient::SendBytes(const TArray<uint8>& Data)
{
    if (!Socket.IsValid() || !bConnected) return false;
    Socket->Send(Data, false);
    return true;
}

void FQdhWebSocketClient::Tick(float DeltaTime)
{
    // Messages are dispatched on the game thread via events;
    // additional per-tick processing can go here if needed.
}

void FQdhWebSocketClient::HandleConnected()
{
    bConnected = true;
    ReconnectAttempts = 0;
    UE_LOG(LogQdhWs, Log, TEXT("Connected to %s"), *ServerUrl);
    ConnectionStateEvent.Broadcast(true);
    ConnectedEvent.Broadcast();
}

void FQdhWebSocketClient::HandleDisconnected(int32 StatusCode, const FString& Reason, bool bWasClean)
{
    UE_LOG(LogQdhWs, Log, TEXT("Disconnected (code=%d, reason=%s, clean=%d)"), StatusCode, *Reason, bWasClean);
    bConnected = false;
    ConnectionStateEvent.Broadcast(false);
    DisconnectedEvent.Broadcast();
    ScheduleReconnect();
}

void FQdhWebSocketClient::HandleMessage(const FString& Message)
{
    JsonMessageEvent.Broadcast(Message);
}

void FQdhWebSocketClient::HandleRawMessage(const TArray<uint8>& Data, bool bIsLast)
{
    if (Data.Num() > 0)
    {
        BinaryMessageEvent.Broadcast(Data, Data.Num());
    }
}

void FQdhWebSocketClient::ScheduleReconnect()
{
    if (ReconnectAttempts >= MaxReconnectAttempts)
    {
        UE_LOG(LogQdhWs, Warning, TEXT("Max reconnect attempts reached (%d)"), MaxReconnectAttempts);
        return;
    }

    float Delay = FMath::Min(BaseReconnectDelay * FMath::Pow(1.5f, ReconnectAttempts), 60.0f);
    ReconnectAttempts++;

    // Add some jitter
    Delay += FMath::FRandRange(0.0f, 1.0f);

    UE_LOG(LogQdhWs, Log, TEXT("Reconnecting in %.1f seconds (attempt %d/%d)"), Delay, ReconnectAttempts, MaxReconnectAttempts);

    if (UWorld* World = GWorld)
    {
        World->GetTimerManager().SetTimer(ReconnectTimerHandle, [this]() {
            if (Socket.IsValid()) Socket->Connect();
            else Connect(ServerUrl);
        }, Delay, false);
    }
}