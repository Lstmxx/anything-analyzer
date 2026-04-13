import { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Input, List, Typography, Space, Tag, message, Popconfirm } from 'antd'
import { PlusOutlined, UndoOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import type { PromptTemplate } from '@shared/types'

const { Text } = Typography
const { TextArea } = Input

interface Props {
  open: boolean
  onClose: () => void
}

export default function PromptTemplateModal({ open, onClose }: Props) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<PromptTemplate | null>(null)
  const [dirty, setDirty] = useState(false)

  const loadAll = useCallback(async () => {
    const list = await window.electronAPI.getPromptTemplates()
    setTemplates(list)
    // Auto-select first if nothing selected
    if (!selectedId && list.length > 0) {
      setSelectedId(list[0].id)
      setEditForm({ ...list[0] })
    }
  }, [selectedId])

  useEffect(() => {
    if (open) loadAll()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id: string) => {
    const t = templates.find((tpl) => tpl.id === id)
    if (!t) return
    setSelectedId(id)
    setEditForm({ ...t })
    setDirty(false)
  }

  const handleFieldChange = (field: keyof PromptTemplate, value: string) => {
    if (!editForm) return
    setEditForm({ ...editForm, [field]: value })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!editForm) return
    await window.electronAPI.savePromptTemplate(editForm)
    message.success('模板已保存')
    setDirty(false)
    await loadAll()
  }

  const handleReset = async () => {
    if (!editForm || !editForm.isBuiltin) return
    await window.electronAPI.resetPromptTemplate(editForm.id)
    message.success('已恢复默认')
    const list = await window.electronAPI.getPromptTemplates()
    setTemplates(list)
    const restored = list.find((t) => t.id === editForm.id)
    if (restored) {
      setEditForm({ ...restored })
      setDirty(false)
    }
  }

  const handleDelete = async () => {
    if (!editForm || editForm.isBuiltin) return
    await window.electronAPI.deletePromptTemplate(editForm.id)
    message.success('模板已删除')
    setSelectedId(null)
    setEditForm(null)
    setDirty(false)
    const list = await window.electronAPI.getPromptTemplates()
    setTemplates(list)
    if (list.length > 0) {
      setSelectedId(list[0].id)
      setEditForm({ ...list[0] })
    }
  }

  const handleCreate = () => {
    const newTemplate: PromptTemplate = {
      id: uuidv4(),
      name: '新模板',
      description: '',
      systemPrompt: '你是一位网站协议分析专家。你的任务是分析用户在网站上的操作过程中产生的HTTP请求、JS调用和存储变化，识别其业务场景，并生成结构化的协议分析报告。Be precise and technical. Output in Chinese (Simplified).',
      requirements: '',
      isBuiltin: false,
      isModified: false,
    }
    setSelectedId(newTemplate.id)
    setEditForm(newTemplate)
    setDirty(true)
  }

  return (
    <Modal
      title="提示词模板管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: 520 }}>
        {/* Left: template list */}
        <div style={{
          width: 200,
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          <div style={{ padding: '8px 12px' }}>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              block
              size="small"
              onClick={handleCreate}
            >
              新建模板
            </Button>
          </div>
          <List
            size="small"
            dataSource={templates}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                onClick={() => handleSelect(item.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 12px',
                  background: selectedId === item.id ? 'rgba(22, 119, 255, 0.15)' : 'transparent',
                  borderLeft: selectedId === item.id ? '3px solid #1677ff' : '3px solid transparent',
                }}
              >
                <div style={{ minWidth: 0, width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Text ellipsis style={{ fontSize: 13, flex: 1 }}>{item.name}</Text>
                    {item.isBuiltin && <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>内置</Tag>}
                    {item.isModified && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>已改</Tag>}
                  </div>
                  <Text type="secondary" ellipsis style={{ fontSize: 11 }}>{item.description}</Text>
                </div>
              </List.Item>
            )}
          />
        </div>

        {/* Right: edit form */}
        <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {editForm ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>名称</Text>
                  <Input
                    value={editForm.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    size="small"
                    disabled={editForm.isBuiltin}
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>描述</Text>
                  <Input
                    value={editForm.description}
                    onChange={(e) => handleFieldChange('description', e.target.value)}
                    size="small"
                  />
                </div>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>System Prompt</Text>
                <TextArea
                  value={editForm.systemPrompt}
                  onChange={(e) => handleFieldChange('systemPrompt', e.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  style={{ fontSize: 12 }}
                />
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>分析要求</Text>
                <TextArea
                  value={editForm.requirements}
                  onChange={(e) => handleFieldChange('requirements', e.target.value)}
                  style={{ flex: 1, fontSize: 12, resize: 'none' }}
                />
              </div>

              <Space style={{ justifyContent: 'flex-end' }}>
                {editForm.isBuiltin && editForm.isModified && (
                  <Popconfirm title="确定恢复默认？" onConfirm={handleReset}>
                    <Button size="small" icon={<UndoOutlined />}>恢复默认</Button>
                  </Popconfirm>
                )}
                {!editForm.isBuiltin && (
                  <Popconfirm title="确定删除该模板？" onConfirm={handleDelete}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  disabled={!dirty}
                >
                  保存
                </Button>
              </Space>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text type="secondary">选择或新建模板</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
