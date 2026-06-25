// Copyright QDH. All Rights Reserved.

using UnrealBuildTool;

public class QwenDigitalHumanEditorTarget : TargetRules
{
    public QwenDigitalHumanEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V4;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
        ExtraModuleNames.AddRange(new string[] { "QwenDigitalHuman" });
    }
}