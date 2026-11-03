import React from 'react';
import {
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
  Typography,
} from 'antd';
import type { AutomationStep } from '../../../common/automation';

const { Text } = Typography;

interface AutomationActionFieldsProps {
  step: AutomationStep;
  update: (patch: Partial<AutomationStep>) => void;
}

const handOptions = [
  { value: 'main', label: 'Main hand' },
  { value: 'off', label: 'Off hand' },
];

const blockFaceOptions = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
  { value: 'west', label: 'West' },
];

const screenActionOptions = [
  'button',
  'recipe',
  'trade',
  'rename',
  'beacon',
  'book',
  'sign',
  'bundle',
  'creativeSlot',
  'pickItem',
  'spectatorTeleport',
].map((action) => ({ value: action, label: action }));

const AutomationActionFields: React.FC<AutomationActionFieldsProps> = ({
  step,
  update,
}) => {
  switch (step.kind) {
    case 'movePath':
      return (
        <Text type="secondary" style={{ fontSize: 13 }}>
          Recorded motion contains {step.points.length} frames and is replayed
          as tick-level controls.
        </Text>
      );

    case 'chat':
      return (
        <Form.Item label="Chat Message" style={{ marginBottom: 0 }}>
          <Input.TextArea
            value={step.message}
            placeholder="Type message or command..."
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(event) =>
              update({ message: event.target.value } as Partial<AutomationStep>)
            }
          />
        </Form.Item>
      );

    case 'hotbar':
      return (
        <Form.Item label="Hotbar Slot" style={{ marginBottom: 0 }}>
          <InputNumber
            min={0}
            max={8}
            value={step.slot}
            onChange={(slot) =>
              update({ slot: slot ?? 0 } as Partial<AutomationStep>)
            }
            addonBefore="Slot"
            style={{ width: '100%' }}
          />
        </Form.Item>
      );

    case 'windowClick':
      return (
        <Flex vertical gap="small" style={{ width: '100%' }}>
          <Form.Item label="Window Title" style={{ marginBottom: 0 }}>
            <Input
              value={step.window.title}
              placeholder="Window title"
              onChange={(event) =>
                update({
                  window: { ...step.window, title: event.target.value },
                } as Partial<AutomationStep>)
              }
            />
          </Form.Item>
          <Row gutter={[8, 8]}>
            <Col xs={24} sm={12}>
              <Form.Item label="Slot" style={{ marginBottom: 0 }}>
                <InputNumber
                  value={step.slot}
                  onChange={(slot) =>
                    update({ slot: slot ?? 0 } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Button" style={{ marginBottom: 0 }}>
                <InputNumber
                  value={step.button}
                  onChange={(button) =>
                    update({ button: button ?? 0 } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Action Type" style={{ marginBottom: 0 }}>
            <Input
              value={step.actionType}
              placeholder="Action Type (e.g. PICKUP)"
              onChange={(event) =>
                update({
                  actionType: event.target.value,
                } as Partial<AutomationStep>)
              }
            />
          </Form.Item>
        </Flex>
      );

    case 'closeWindow':
      return (
        <Form.Item label="Window Title" style={{ marginBottom: 0 }}>
          <Input
            value={step.window?.title}
            placeholder="Window title (optional)"
            onChange={(event) =>
              update({
                window: { ...step.window, title: event.target.value },
              } as Partial<AutomationStep>)
            }
          />
        </Form.Item>
      );

    case 'attackEntity':
    case 'useEntity':
      return (
        <Flex vertical gap="small" style={{ width: '100%' }}>
          <Form.Item label="Entity Type" style={{ marginBottom: 0 }}>
            <Input
              value={step.entity.type}
              placeholder="minecraft:pig"
              onChange={(event) =>
                update({
                  entity: { ...step.entity, type: event.target.value },
                } as Partial<AutomationStep>)
              }
            />
          </Form.Item>
          <Row gutter={[8, 8]}>
            <Col xs={24} sm={12}>
              <Form.Item label="Radius" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={1}
                  max={64}
                  value={step.entity.radius}
                  onChange={(radius) =>
                    update({
                      entity: { ...step.entity, radius: radius ?? 16 },
                    } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Hand" style={{ marginBottom: 0 }}>
                <Select
                  value={step.hand ?? 'main'}
                  onChange={(hand) =>
                    update({ hand } as Partial<AutomationStep>)
                  }
                  options={handOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </Flex>
      );

    case 'breakBlock':
    case 'useBlock':
      return (
        <Flex vertical gap="small" style={{ width: '100%' }}>
          <Form.Item label="Absolute Coordinates" style={{ marginBottom: 0 }}>
            <Row gutter={[8, 8]}>
              <Col span={8}>
                <InputNumber
                  value={step.position.absolute.x}
                  addonBefore="X"
                  onChange={(x) =>
                    update({
                      position: {
                        ...step.position,
                        absolute: {
                          ...step.position.absolute,
                          x: x ?? 0,
                        },
                      },
                    } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  value={step.position.absolute.y}
                  addonBefore="Y"
                  onChange={(y) =>
                    update({
                      position: {
                        ...step.position,
                        absolute: {
                          ...step.position.absolute,
                          y: y ?? 0,
                        },
                      },
                    } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  value={step.position.absolute.z}
                  addonBefore="Z"
                  onChange={(z) =>
                    update({
                      position: {
                        ...step.position,
                        absolute: {
                          ...step.position.absolute,
                          z: z ?? 0,
                        },
                      },
                    } as Partial<AutomationStep>)
                  }
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>
          </Form.Item>
          <Row gutter={[8, 8]}>
            <Col xs={24} sm={12}>
              <Form.Item label="Block Face" style={{ marginBottom: 0 }}>
                <Select
                  value={step.face ?? 'up'}
                  onChange={(face) =>
                    update({ face } as Partial<AutomationStep>)
                  }
                  options={blockFaceOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Hand" style={{ marginBottom: 0 }}>
                <Select
                  value={step.hand ?? 'main'}
                  onChange={(hand) =>
                    update({ hand } as Partial<AutomationStep>)
                  }
                  options={handOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </Flex>
      );

    case 'useItem':
    case 'releaseUseItem':
    case 'swingArm':
    case 'swapHands':
      return (
        <Form.Item label="Hand" style={{ marginBottom: 0 }}>
          <Select
            value={step.hand ?? 'main'}
            onChange={(hand) => update({ hand } as Partial<AutomationStep>)}
            options={handOptions}
            style={{ width: '100%' }}
          />
        </Form.Item>
      );

    case 'dropItem':
      return (
        <Form.Item label="Drop Entire Stack" style={{ marginBottom: 0 }}>
          <Switch
            checked={Boolean(step.entireStack)}
            onChange={(entireStack) =>
              update({ entireStack } as Partial<AutomationStep>)
            }
          />
        </Form.Item>
      );

    case 'screenAction':
      return (
        <Form.Item label="Screen Action" style={{ marginBottom: 0 }}>
          <Select
            value={step.action}
            onChange={(action) =>
              update({ action } as Partial<AutomationStep>)
            }
            options={screenActionOptions}
            style={{ width: '100%' }}
          />
        </Form.Item>
      );

    default:
      return (
        <Text type="secondary" style={{ fontSize: 13 }}>
          This action uses the recorded target and timing.
        </Text>
      );
  }
};

export default AutomationActionFields;
