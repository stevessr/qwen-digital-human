// Copyright QDH. All Rights Reserved.

using UnrealBuildTool;

public class QdhMetaHumanBridge : ModuleRules
{
    public QdhMetaHumanBridge(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "WebSockets",
            "Networking",
            "Sockets",
            "AudioMixer",
            "AudioExtensions",
            "Projects",
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Json",
            "JsonUtilities",
            "SignalProcessing",
        });
    }
}