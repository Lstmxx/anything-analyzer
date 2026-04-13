import { useEffect, useState, useCallback } from 'react'
import { Modal, Form, Input, Select, InputNumber, Button, Progress, Divider, Space, Tag, message, Typography } from 'antd'
import { SyncOutlined, CheckCircleOutlined, CloseCircleOutlined, CloudDownloadOutlined, EditOutlined, ApiOutlined } from '@ant-design/icons'
import type { LLMProviderConfig, LLMProviderType, OpenAIApiType, UpdateStatus } from '@shared/types'
import PromptTemplateModal from './PromptTemplateModal'
import MCPServerModal from './MCPServerModal'

const { Text } = Typography

const defaultUrls: Record<LLMProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  custom: ''
}

interface Props { open: boolean; onClose: () => void }

export default function SettingsModal({ open, onClose }: Props) {
  const [form] = Form.useForm()
  const providerValue = Form.useWatch('name', form)
  const showApiType = providerValue === 'openai' || providerValue === 'custom'

  // Update state
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [mcpModalOpen, setMcpModalOpen] = useState(false)

  useEffect(() => {
    if (open) {
      window.electronAPI.getLLMConfig().then(config => {
        if (config) form.setFieldsValue(config)
      })
      window.electronAPI.getAppVersion().then(setAppVersion)
    }
  }, [open, form])

  // Subscribe to update status events
  useEffect(() => {
    window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
      setUpdateStatus(status)
    })
    return () => {
      window.electronAPI.removeAllListeners('update:status')
    }
  }, [])

  const handleProviderChange = (value: LLMProviderType) => {
    form.setFieldValue('baseUrl', defaultUrls[value])
    if (value === 'anthropic') {
      form.setFieldValue('apiType', undefined)
    } else if (!form.getFieldValue('apiType')) {
      form.setFieldValue('apiType', 'completions')
    }
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    await window.electronAPI.saveLLMConfig(values as LLMProviderConfig)
    message.success('LLM configuration saved')
    onClose()
  }

  const handleCheckUpdate = useCallback(() => {
    setUpdateStatus({ state: 'checking' })
    window.electronAPI.checkForUpdate()
  }, [])

  const handleInstallUpdate = useCallback(() => {
    window.electronAPI.installUpdate()
  }, [])

  return (
    <Modal title="Settings" open={open} onOk={handleSave} onCancel={onClose} okText="Save">
      {/* About & Update */}
      <div style={{ marginBottom: 12 }}>
        <Text strong>Anything Analyzer</Text>
        <Text type="secondary" style={{ marginLeft: 8 }}>v{appVersion}</Text>
      </div>

      <Space style={{ width: '100%', marginBottom: 4 }}>
        {updateStatus.state === 'idle' && (
          <Button size="small" icon={<SyncOutlined />} onClick={handleCheckUpdate}>检查更新</Button>
        )}
        {updateStatus.state === 'checking' && (
          <Button size="small" icon={<SyncOutlined spin />} disabled>正在检查...</Button>
        )}
        {updateStatus.state === 'not-available' && (
          <>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <Text>已是最新版本</Text>
            <Button size="small" onClick={handleCheckUpdate}>重新检查</Button>
          </>
        )}
        {updateStatus.state === 'available' && (
          <>
            <Tag color="blue">v{updateStatus.info?.version} 可用</Tag>
            <Text type="secondary">正在下载...</Text>
          </>
        )}
        {updateStatus.state === 'downloaded' && (
          <>
            <CloudDownloadOutlined style={{ color: '#1677ff' }} />
            <Text>v{updateStatus.info?.version} 已就绪</Text>
            <Button type="primary" size="small" onClick={handleInstallUpdate}>立即重启更新</Button>
          </>
        )}
        {updateStatus.state === 'error' && (
          <>
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
            <Text type="danger" style={{ fontSize: 12 }}>{updateStatus.error}</Text>
            <Button size="small" onClick={handleCheckUpdate}>重试</Button>
          </>
        )}
      </Space>

      {updateStatus.state === 'downloading' && (
        <Progress
          percent={Math.round(updateStatus.progress?.percent ?? 0)}
          size="small"
          status="active"
          style={{ marginBottom: 4 }}
        />
      )}

      <Divider style={{ margin: '12px 0' }} />

      {/* LLM Settings */}
      <Form form={form} layout="vertical" initialValues={{ name: 'openai', baseUrl: defaultUrls.openai, maxTokens: 4096, apiType: 'completions' as OpenAIApiType }}>
        <Form.Item name="name" label="Provider" rules={[{ required: true }]}>
          <Select onChange={handleProviderChange} options={[
            { label: 'OpenAI', value: 'openai' },
            { label: 'Anthropic', value: 'anthropic' },
            { label: 'Custom (OpenAI Compatible)', value: 'custom' }
          ]} />
        </Form.Item>
        {showApiType && (
          <Form.Item name="apiType" label="API Type">
            <Select options={[
              { label: 'Chat Completions (/chat/completions)', value: 'completions' },
              { label: 'Responses (/responses)', value: 'responses' }
            ]} />
          </Form.Item>
        )}
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item name="model" label="Model" rules={[{ required: true }]}>
          <Input placeholder="gpt-4o / claude-sonnet-4-20250514 / ..." />
        </Form.Item>
        <Form.Item name="maxTokens" label="Max Tokens">
          <InputNumber min={256} max={128000} style={{ width: '100%' }} />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '12px 0' }} />

      {/* Prompt Template Management */}
      <Button icon={<EditOutlined />} block onClick={() => setTemplateModalOpen(true)}>
        管理提示词模板
      </Button>

      <div style={{ marginTop: 8 }} />

      {/* MCP Server Management */}
      <Button icon={<ApiOutlined />} block onClick={() => setMcpModalOpen(true)}>
        管理 MCP 服务器
      </Button>

      <PromptTemplateModal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} />
      <MCPServerModal open={mcpModalOpen} onClose={() => setMcpModalOpen(false)} />
    </Modal>
  )
}
