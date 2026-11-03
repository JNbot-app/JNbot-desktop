import { Tour, TourStepProps } from 'antd';
import { FC, useState } from 'react';

const AddAltsTour: FC<{
  active: boolean;
  setActive: (active: boolean) => void;
}> = ({ active, setActive }) => {
  const [step, setStep] = useState(0);

  const steps: (TourStepProps & { selector: string })[] = [
    {
      title: "Let's go to alt tab",
      description: 'To add a new alt we must first go to the accounts page.',
      target: () => {
        return window.document.querySelector(steps[0].selector)! as HTMLElement;
      },
      selector: '.alt-tutorial-step-0',
    },

    {
      title: 'Click on the accounts page',
      description: 'Next we click on the account page',
      target: () => {
        if (
          !document.querySelector('.ant-menu-submenu-open' + steps[0].selector)
        ) {
          const prevSelector = steps[0].selector;
          (window.document.querySelector(prevSelector + " > div") as HTMLElement)?.click();
        }

        const currSelector = steps[1].selector;
        return window.document.querySelector(currSelector) as HTMLElement;
      },
      selector: '.alt-tutorial-step-1',
    },
    {
      title: 'Click on create alt',
      target: () => {
        const currSelector = steps[2].selector;
        const el = window.document.querySelector(currSelector);
        if (el !== null) return el as HTMLElement;
        const prevSelector = steps[1].selector;
        (window.document.querySelector(prevSelector) as HTMLElement)?.click();
        return window.document.querySelector(currSelector) as HTMLElement;
      },
      selector: '#add-alt-tutorial-step',
    },
    {
      title: 'Enter your alt details',
      description: 'Write the username & password of an alt account.',
      target: () => {
        const currSelector = steps[3].selector;
        const el = window.document.querySelector(currSelector);
        if (el) return el as HTMLElement;

        return window.document.querySelector(currSelector)!;
      },

      selector: '.ant-drawer-open #alt-details-tutorial-step',
    },
    {
      title: 'Save your alt',
      description:
        'Once you have filled all the fields you can save your alt. You are not required to enter all the gkits and ranks.',
      target: () => {
        const currSelector = steps[4].selector;
        return window.document.querySelector(currSelector)!;
      },
      selector: '#save-alt-tutorial-step',
    },
  ];

  const onChange = async (current: number) => {
    if (current === 3) {
      const currSelector = steps[3].selector;
      const el = window.document.querySelector(currSelector);
      if (!el) {
        const prevSelector = steps[2].selector;
        (window.document.querySelector(prevSelector) as HTMLElement)?.click();
        await sleep(500);
      }
    }

    setStep(current);
  };

  const onClose = () => {
    setStep(0);
    setActive(false);
  };

  return (
    <Tour
      current={step}
      onChange={onChange}
      open={active}
      onClose={onClose}
      steps={steps}
    />
  );
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default AddAltsTour;
