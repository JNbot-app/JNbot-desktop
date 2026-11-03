import { launcherToText } from '../components/mcLauncher/versionUtils';
import { MinecraftLauncherTypes } from '../../common/CommonEnums';
import { ModInfo, ModList, ModpackInfo } from '../../main/src/types';
import { useState, useEffect, useCallback } from 'react';

interface UseModsManagerProps {
  selectedVersionId: string | undefined;
  selectedLoader: MinecraftLauncherTypes;
}

export const useModsManager = ({
  selectedVersionId,
  selectedLoader,
}: UseModsManagerProps) => {
  const [mods, setMods] = useState<{mods: ModInfo[], modpacks: ModpackInfo[]}>({mods: [], modpacks: []});
  const [activeMods, setActiveMods] = useState<{activeMods: string[], activeModPacks: string[]}>({activeMods: [], activeModPacks: []});
  const [modsLoading, setModsLoading] = useState(false);
  const [featuredMods, setFeaturedMods] = useState<{
    mods: ModInfo[];
    modpacks: ModpackInfo[];
}>({mods: [], modpacks: []});

  useEffect(() => {
    
    const removeListener = window.ipcRenderer.on("LAUNCHER_MODS", (mods:ModList) => {
      if(mods.mcVersion !== selectedVersionId) return;
      setMods({mods: mods.mods, modpacks: mods.modpacks});
      setActiveMods({activeMods: mods.activeMods, activeModPacks: mods.activeModPacks});
      setModsLoading(false);
    })

    window.ipcRenderer.action("LAUNCHER_MODS", selectedVersionId)
    return removeListener
  }, [selectedVersionId]);

  const handleAddMods = useCallback(async (modId:string, type: "mod" | "modpack",isProject:boolean) => {
    if(!selectedVersionId) return;

    const loaderText = launcherToText(selectedLoader);

    await window.ipcRenderer.action("ADD_MINECRAFT_MOD", {
      type,
      modId,
      version: selectedVersionId!,
      isProject,
      loader: loaderText
    })  

  }, [selectedVersionId]);

  const handleRemoveMod = useCallback(
    async (modId: string, type: "mod" | "modpack", isProject:boolean) => {
      if(!selectedVersionId) return;

      const loaderText = launcherToText(selectedLoader);


      await window.ipcRenderer.action("REMOVE_MINECRAFT_MOD", {
        modId,
        type,
        version: selectedVersionId!,
        isProject,
        loader: loaderText
      })
    },
    [selectedVersionId],
  );

  const getFeaturedMods = useCallback(async () => {
    if(!selectedVersionId) return;
    const featuredMods = await window.ipcRenderer.get<any>("GET_FEATURED_MINECRAFT_MODS", selectedVersionId);
    setFeaturedMods({
      mods: featuredMods.mods,
      modpacks: featuredMods.modpacks,
    });
  }, [selectedVersionId])

  return {
    mods,
    modsLoading,
    handleAddMods,
    handleRemoveMod,
    activeMods,
    featuredMods,
    getFeaturedMods,
  };
};
