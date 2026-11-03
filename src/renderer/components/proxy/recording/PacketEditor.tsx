import type React from "react"

import { useState, useEffect } from "react"
import { Modal, Form, Input, Button, Typography } from "antd"
import { DeleteOutlined } from "@ant-design/icons"

const { Text } = Typography

interface RecordingPacket {
  n: string
  dt: number
  p: Record<string, any>
  m: Record<string, any>
}

interface PacketEditorProps {
  packet: RecordingPacket | null
  open: boolean
  onClose: () => void
  onSave: (packet: RecordingPacket) => void
  onDelete: (packet: RecordingPacket) => void
}

export const PacketEditor: React.FC<PacketEditorProps> = ({ packet, open, onClose, onSave, onDelete }) => {
  const [form] = Form.useForm()
  const [packetContent, setPacketContent] = useState("")
  const [metadata, setMetadata] = useState("")

  useEffect(() => {
    if (packet) {
      form.setFieldsValue({
        deltaTime: packet.dt,
      })
      setPacketContent(JSON.stringify(packet.p, null, 2))
      setMetadata(JSON.stringify(packet.m, null, 2))
    }
  }, [packet, form])

  const handleSave = () => {
    form.validateFields().then((values) => {
      if (!packet) return

      try {
        const parsedContent = JSON.parse(packetContent)
        const parsedMetadata = JSON.parse(metadata)

        onSave({
          ...packet,
          dt: values.deltaTime,
          p: parsedContent,
          m: parsedMetadata,
        })
      } catch (error) {
        // Handle JSON parse error
        console.error("Invalid JSON format")
      }
    })
  }

  const handleDelete = () => {
    if (!packet) return
    onDelete(packet)
    onClose()
  }

  if (!packet) return null

  return (
    <Modal
      title={`Edit Packet: ${packet.n}`}
      open={open}
      onCancel={onClose}
      width={800}
      footer={[
        <Button key="delete" danger icon={<DeleteOutlined />} onClick={handleDelete}>
          Delete Packet
        </Button>,
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          Save Changes
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item>
          <Text strong>Packet Type: </Text>
          <Text>{packet.n}</Text>
        </Form.Item>

        <Form.Item label="Delta Time (ms)" name="deltaTime" rules={[{ required: true }]}>
          <Input type="number" />
        </Form.Item>

        <Form.Item label="Packet Content" required>
          <Input.TextArea
            value={packetContent}
            onChange={(e) => setPacketContent(e.target.value)}
            rows={10}
            style={{ fontFamily: "monospace" }}
          />
        </Form.Item>

        <Form.Item label="Metadata" required>
          <Input.TextArea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            rows={6}
            style={{ fontFamily: "monospace" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

