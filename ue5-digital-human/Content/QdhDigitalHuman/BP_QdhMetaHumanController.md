// Blueprint skeleton for BP_QdhMetaHumanController
//
// This file documents the expected Blueprint implementation.
// Create the Blueprint in UE5 Editor and implement these event graphs.
//
// === Event Graph ===
//
// Event BeginPlay (inherited from AQdhMetaHumanController)
//   → Parent: BeginPlay         // auto-connects WebSocket
//   → (optional) Start custom initialization
//
// Event Tick (inherited, DeltaTime)
//   → Parent: Tick(DeltaTime)   // drives lip-sync timeline
//   → (optional) Update UI, camera, etc.
//
// === OnExpressionUpdated ===
//
// Inputs: Emotion (String), MouthOpen, JawOpen, LipRound, Smile, Blink (Float)
//
// Graph:
//   [OnExpressionUpdated]
//   → Get MetaHuman Face component (from owned MetaHuman actor)
//   → Set ControlRig parameter: jaw_open = JawOpen
//   → Set ControlRig parameter: mouth_open = MouthOpen
//   → Set ControlRig parameter: lip_round = LipRound
//   → Set ControlRig parameter: smile = Smile
//   → Set ControlRig parameter: blink = Blink
//   → (optional) Trigger animation blueprint for emotion
//
// === OnBackendConnectionStateChanged ===
//
// Inputs: bConnected (Boolean)
//
// Graph:
//   [OnBackendConnectionStateChanged]
//   → Branch (bConnected)
//     → True:  Set ConnectionStatus text → "已连接"
//     → False: Set ConnectionStatus text → "已断开"
//   → (optional) Toggle visibility of connection indicator widget
//
// === ConnectToBackend ===
//
// Graph:
//   → Parent: ConnectToBackend
//   → (optional) Retry connection every 5 seconds if failed
//
// === OnBackendLog ===
//
// Inputs: Message (String)
//
// Graph:
//   → Print String (Message)
//   → (optional) Log to on-screen debug display
//
// ============================================================
// MetaHuman Face ControlRig Parameters (typical names):
//   - jaw_open
//   - mouth_open
//   - lip_round
//   - smile
//   - blink
//   - tongue_forward
//   - tongue_up / tongue_down
//   - upper_teeth_show / lower_teeth_show
//   - head_yaw / head_pitch / head_roll
// ============================================================