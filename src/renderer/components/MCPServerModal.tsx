import { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Input, List, Typography, Space, Switch, message, Popconfirm, Segmented } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, ApiOutlined } from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import type { MCPServerConfig } from '@shared/types'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

/** stdio 默认 JSON 模板 */
const STDIO_TEMPLATE = JSON.stringify({ command: '', args: [], env: {} }, null, 2)
/** HTTP 默认 JSON 模板 */
const HTTP_TEMPLATE = JSON.stringify({ url: '' }, null, 2)

/**
 * 从 MCPServerConfig 提取传输相关字段，生成 JSON 文本
 */
function configToJson(config: MCPServerConfig): string {
  if (config.transport === 'streamableHttp') {
    const payload: Record<string, unknown> = { url: config.url }
    if (config.headers && Object.keys(config.headers).length > 0) {
      payload.headers = config.headers
    }
    return JSON.stringify(payload, null, 2)
  }
  return JSON.stringify(
    { command: config.command, args: config.args, env: config.env },
    null,
    2,
  )
}

/**
 * 获取左侧列表中的描述文本
 */
function getServerDescription(server: MCPServerConfig): string {
  if (server.transport === 'streamableHttp') {
    return server.url || '未配置 URL'
  }
  return [server.command, ...server.args].filter(Boolean).join(' ') || '未配置命令'
}

export default function MCPServerModal({ open, onClose }: Props) {
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<MCPServerConfig | null>(null)
  const [dirty, setDirty] = useState(false)

  // 传输类型 + JSON 编辑器状态
  const [transportType, setTransportType] = useState<'stdio' | 'streamableHttp'>('stdio')
  const [jsonText, setJsonText] = useState(STDIO_TEMPLATE)
  const [jsonError, setJsonError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const list = await window.electronAPI.getMCPServers()
    setServers(list)
    if (!selectedId && list.length > 0) {
      selectServer(list[0])
    }
  }, [selectedId])

  useEffect(() => {
    if (open) loadAll()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectServer = (server: MCPServerConfig) => {
    setSelectedId(server.id)
    setEditForm({ ...server })
    setTransportType(server.transport)
    setJsonText(configToJson(server))
    setJsonError(null)
    setDirty(false)
  }

  const handleSelect = (id: string) => {
    const s = servers.find((srv) => srv.id === id)
    if (s) selectServer(s)
  }

  const handleTransportTypeChange = (type: 'stdio' | 'streamableHttp') => {
    setTransportType(type)
    const template = type === 'stdio' ? STDIO_TEMPLATE : HTTP_TEMPLATE
    setJsonText(template)
    setJsonError(null)
    if (editForm) {
      const base = { id: editForm.id, name: editForm.name, enabled: editForm.enabled }
      setEditForm(
        type === 'stdio'
          ? { ...base, transport: 'stdio', command: '', args: [], env: {} }
          : { ...base, transport: 'streamableHttp', url: '' },
      )
      setDirty(true)
    }
  }

  const handleJsonChange = (text: string) => {
    setJsonText(text)
    setDirty(true)
    try {
      const parsed = JSON.parse(text)
      setJsonError(null)
      // 自动检测传输类型
      if (parsed.url && !parsed.command) {
        setTransportType('streamableHttp')
      } else if (parsed.command && !parsed.url) {
        setTransportType('stdio')
      }
    } catch (e) {
      setJsonError(`JSON 格式错误: ${(e as Error).message}`)
    }
  }

  const handleNameChange = (name: string) => {
    if (!editForm) return
    setEditForm({ ...editForm, name } as MCPServerConfig)
    setDirty(true)
  }

  const handleEnabledChange = (enabled: boolean) => {
    if (!editForm) return
    setEditForm({ ...editForm, enabled } as MCPServerConfig)
    setDirty(true)
  }

  const handleSave = async () => {
    if (!editForm) return
    if (!editForm.name.trim()) {
      message.warning('请输入服务器名称')
      return
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      message.error(`JSON 格式错误: ${(e as Error).message}`)
      return
    }

    let serverConfig: MCPServerConfig
    const base = { id: editForm.id, name: editForm.name, enabled: editForm.enabled }

    if (transportType === 'streamableHttp') {
      const url = parsed.url
      if (typeof url !== 'string' || !url.trim()) {
        message.warning('请输入服务器 URL')
        return
      }
      try {
        new URL(url)
      } catch {
        message.warning('URL 格式无效')
        return
      }
      serverConfig = {
        ...base,
        transport: 'streamableHttp',
        url: (url as string).trim(),
        headers: (parsed.headers as Record<string, string>) || undefined,
      }
    } else {
      const command = parsed.command
      if (typeof command !== 'string' || !command.trim()) {
        message.warning('请输入启动命令')
        return
      }
      serverConfig = {
        ...base,
        transport: 'stdio',
        command: (command as string).trim(),
        args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
        env: (parsed.env as Record<string, string>) || {},
      }
    }

    await window.electronAPI.saveMCPServer(serverConfig)
    message.success('MCP 服务器已保存')
    setDirty(false)
    const list = await window.electronAPI.getMCPServers()
    setServers(list)
  }

  const handleDelete = async () => {
    if (!editForm) return
    await window.electronAPI.deleteMCPServer(editForm.id)
    message.success('MCP 服务器已删除')
    setSelectedId(null)
    setEditForm(null)
    setDirty(false)
    const list = await window.electronAPI.getMCPServers()
    setServers(list)
    if (list.length > 0) selectServer(list[0])
  }

  const handleCreate = () => {
    const id = uuidv4()
    const newServer: MCPServerConfig = {
      id,
      name: '',
      enabled: true,
      transport: 'stdio',
      command: '',
      args: [],
      env: {},
    }
    setSelectedId(id)
    setEditForm(newServer)
    setTransportType('stdio')
    setJsonText(STDIO_TEMPLATE)
    setJsonError(null)
    setDirty(true)
  }

  return (
    <Modal
      title="MCP 服务器管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: 480 }}>
        {/* Left: server list */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            overflow: 'auto',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '8px 12px' }}>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              block
              size="small"
              onClick={handleCreate}
            >
              添加服务器
            </Button>
          </div>
          <List
            size="small"
            dataSource={servers}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                onClick={() => handleSelect(item.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 12px',
                  background:
                    selectedId === item.id ? 'rgba(22, 119, 255, 0.15)' : 'transparent',
                  borderLeft:
                    selectedId === item.id
                      ? '3px solid #1677ff'
                      : '3px solid transparent',
                }}
              >
                <div style={{ minWidth: 0, width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ApiOutlined
                      style={{ color: item.enabled ? '#52c41a' : '#8c8c8c', fontSize: 12 }}
                    />
                    <Text ellipsis style={{ fontSize: 13, flex: 1 }}>
                      {item.name || '未命名'}
                    </Text>
                  </div>
                  <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                    {getServerDescription(item)}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        </div>

        {/* Right: edit panel */}
        <div
          style={{
            flex: 1,
            padding: 16,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {editForm ? (
            <>
              {/* 名称 + 启用 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    名称
                  </Text>
                  <Input
                    value={editForm.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="如：文件系统 / 远程搜索"
                    size="small"
                  />
                </div>
                <div style={{ paddingTop: 18 }}>
                  <Space size={4}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      启用
                    </Text>
                    <Switch
                      checked={editForm.enabled}
                      onChange={handleEnabledChange}
                      size="small"
                    />
                  </Space>
                </div>
              </div>

              {/* 传输类型选择 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  传输类型
                </Text>
                <Segmented
                  size="small"
                  value={transportType}
                  onChange={(val) =>
                    handleTransportTypeChange(val as 'stdio' | 'streamableHttp')
                  }
                  options={[
                    { label: '本地命令 (stdio)', value: 'stdio' },
                    { label: '远程服务 (HTTP)', value: 'streamableHttp' },
                  ]}
                />
              </div>

              {/* JSON 编辑器 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                  配置 (JSON)
                </Text>
                <Input.TextArea
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  status={jsonError ? 'error' : undefined}
                  autoSize={{ minRows: 6, maxRows: 12 }}
                  style={{
                    fontSize: 12,
                    fontFamily:
                      "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                    lineHeight: 1.6,
                  }}
                  placeholder={
                    transportType === 'stdio'
                      ? '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-xxx"],\n  "env": {}\n}'
                      : '{\n  "url": "https://example.com/mcp",\n  "headers": {}\n}'
                  }
                />
                {jsonError && (
                  <Text type="danger" style={{ fontSize: 11, marginTop: 2 }}>
                    {jsonError}
                  </Text>
                )}
              </div>

              {/* 操作按钮 */}
              <Space style={{ justifyContent: 'flex-end', marginTop: 'auto' }}>
                <Popconfirm title="确定删除该服务器？" onConfirm={handleDelete}>
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  disabled={!dirty || !!jsonError}
                >
                  保存
                </Button>
              </Space>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text type="secondary">选择或添加 MCP 服务器</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
