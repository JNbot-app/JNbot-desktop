import { useEffect, useState } from 'react';
import { Tour } from 'antd';
import { useLocation } from 'react-router-dom';

export type OnboardingHintId = 'alt' | 'join' | 'plugin';

/** Navigate to a page and point at its elements (see OnboardingHint). */
export const hintState = (hint: OnboardingHintId) => ({ onboardingHint: hint });

interface HintStep {
  title: string;
  description: string;
  target: () => HTMLElement | null | undefined;
}

// Navigations whose hint was already shown, so a remount doesn't repeat it.
const shown = new Set<string>();

/**
 * Short tour shown when the getting-started checklist navigates here with
 * `hintState(id)`. It shows once per navigation.
 */
const OnboardingHint = ({ id, steps }: { id: OnboardingHintId; steps: HintStep[] }) => {
  const { key, state } = useLocation();
  const [closedKey, setClosedKey] = useState(() => (shown.has(key) ? key : null));
  const open =
    (state as { onboardingHint?: string } | null)?.onboardingHint === id &&
    closedKey !== key;

  useEffect(() => {
    if (open) shown.add(key);
  }, [open, key]);

  if (!open) return null;

  const close = () => setClosedKey(key);
  return (
    <Tour
      open
      onClose={close}
      onFinish={close}
      steps={steps.map((step) => ({ ...step, target: () => step.target()! }))}
    />
  );
};

export default OnboardingHint;
