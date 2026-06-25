// Copyright QDH. All Rights Reserved.

using UnrealBuildTool;

public class QwenDigitalHuman : ModuleRules
{
    public QwenDigitalHuman(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "QdhMetaHumanBridge",
        });
    }
}