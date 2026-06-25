#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"

/**
 * WebSocket client for connecting to the QDH Python backend.
 *
 * Connects to ws://<host>:<port>/api/ws/ue5 and handles:
 *   - JSON messages (expression, viseme_sequence, tts_complete, ping)
 *   - Binary messages (PCM16LE audio frames)
 *
 * Uses UE5's built-in WebSockets module (FWebSocket).
 */
class FQdhWebSocketClient
{
public:
    /** Connect to the backend WebSocket endpoint. */
    void Connect(const FString& Url);

    /** Disconnect and clean up the connection. */
    void Disconnect();

    /** Returns true if the WebSocket is currently connected. */
    bool IsConnected() const;

    /** Send a JSON string to the backend. */
    bool SendJson(const FString& JsonString);

    /** Send raw bytes to the backend. */
    bool SendBytes(const TArray<uint8>& Data);

    /** Tick – process received messages on the game thread. */
    void Tick(float DeltaTime);

    /* Called when a JSON text message is received. */
    DECLARE_EVENT_OneParam(FQdhWebSocketClient, FOnJsonMessage, const FString& /*Json*/)
    FOnJsonMessage& OnJsonMessage() { return JsonMessageEvent; }

    /* Called when binary data is received. */
    DECLARE_EVENT_TwoParams(FQdhWebSocketClient, FOnBinaryMessage, const TArray<uint8>& /*Data*/, int32 /*Size*/)
    FOnBinaryMessage& OnBinaryMessage() { return BinaryMessageEvent; }

    /* Called when connection state changes. */
    DECLARE_EVENT_OneParam(FQdhWebSocketClient, FOnConnectionState, bool /*bConnected*/)
    FOnConnectionState& OnConnectionState() { return ConnectionStateEvent; }

    FSimpleMulticastDelegate& OnConnected() { return ConnectedEvent; }
    FSimpleMulticastDelegate& OnDisconnected() { return DisconnectedEvent; }

private:
    /** Internal handler when a connection is established. */
    void HandleConnected();

    /** Internal handler when a connection is closed. */
    void HandleDisconnected(int32 StatusCode, const FString& Reason, bool bWasClean);

    /** Internal handler when a text message arrives. */
    void HandleMessage(const FString& Message);

    /** Internal handler when a binary message arrives. */
    void HandleRawMessage(const TArray<uint8>& Data, bool bIsLast);

    /** Attempt reconnection with exponential backoff. */
    void ScheduleReconnect();

    TSharedPtr<class IWebSocket> Socket;
    FString ServerUrl;
    bool bConnected = false;

    /** Reconnect state */
    int32 ReconnectAttempts = 0;
    static constexpr int32 MaxReconnectAttempts = 10;
    static constexpr float BaseReconnectDelay = 2.0f;
    FTimerHandle ReconnectTimerHandle;

    /** Event delegates */
    FOnJsonMessage JsonMessageEvent;
    FOnBinaryMessage BinaryMessageEvent;
    FOnConnectionState ConnectionStateEvent;
    FSimpleMulticastDelegate ConnectedEvent;
    FSimpleMulticastDelegate DisconnectedEvent;
};