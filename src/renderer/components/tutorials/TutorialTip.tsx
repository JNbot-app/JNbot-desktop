import React, {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { Button, Tooltip, Typography } from 'antd';
import {
  useSettingsStore,
  selectTutorial,
  nextTutorialStep,
} from '../../redux/settings';

interface TutorialTipProps {
  children: ReactNode;
  step: number;
  tutorial: number;
  content: string;
  invisible?: boolean;
  placement?: 'top' | 'left' | 'right' | 'bottom';
  disableClick?: boolean;
  skip?: () => boolean;
}

const tutorialData = [
  { title: 'Add your alts' },
  { title: 'Activate gkit collector' },
  { title: 'Work with bot manager' },
  null,
  null,
  null,
  null,
  null,
  null,
  { title: 'Tutorial' },
];

const TutorialTip = forwardRef<any, TutorialTipProps>(
  (
    {
      children,
      step,
      tutorial,
      content,
      invisible,
      placement = 'top',
      disableClick,
      skip,
    },
    ref,
  ) => {
    const currTutorial = useSettingsStore(selectTutorial);
    const [update, setUpdate] = useState(false);

    useEffect(() => {
      if (
        (currTutorial.step !== step || tutorial !== currTutorial.tutorial) &&
        update
      ) {
        setUpdate(false);
      }
    }, [currTutorial]);

    const next = (e?: React.MouseEvent<HTMLElement>) => {
      if (e?.target) {
        (e.target as HTMLElement).querySelector('input')?.focus();
      }
      nextTutorialStep();
    };

    useImperativeHandle(ref, () => ({
      next,
    }));

    useEffect(() => {
      if (
        !update &&
        !(
          currTutorial.step !== step ||
          tutorial !== currTutorial.tutorial ||
          invisible
        )
      ) {
        setTimeout(() => {
          setUpdate(true);
        }, 500);
      }
    }, [step, update]);

    if (
      currTutorial.step !== step ||
      tutorial !== currTutorial.tutorial ||
      invisible
    ) {
      return <>{children}</>;
    }

    if (typeof skip === 'function' && skip()) {
      next();
    }

    return (
      <Tooltip
        placement={placement}
        color="blue"
        open
        title={
          <>
            <div style={{ textAlign: 'center', padding: 8 }}>
              <Typography.Text
                strong
                style={{
                  fontSize: '1.2em',
                  paddingBottom: '0.2rem',
                  color: 'white',
                }}
              >
                {`${step + 1}. ${tutorialData[currTutorial.tutorial - 1]?.title}`}
              </Typography.Text>
              <Typography.Text style={{ fontSize: '1.1em', color: 'white' }}>
                {content}
              </Typography.Text>
              <br />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                background: 'rgba(0,0,0,0.15)',
                padding: '0 8px',
              }}
            >
              <Button
                onClick={next}
                style={{ color: '#000', fontWeight: 600, width: '100%' }}
              >
                Got it
              </Button>
            </div>
          </>
        }
      >
        <span onClick={disableClick ? undefined : next}>{children}</span>
      </Tooltip>
    );
  },
);

export default TutorialTip;
