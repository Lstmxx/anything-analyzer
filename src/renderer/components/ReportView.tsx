import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Empty, Input, Space, Spin, Tag, Typography } from 'antd'
import {
  ReloadOutlined,
  RobotOutlined,
  FileTextOutlined,
  ExportOutlined,
  SendOutlined,
  MessageOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { AnalysisReport, ChatMessage } from '@shared/types'

const { Text, Title } = Typography

interface ReportViewProps {
  report: AnalysisReport | null
  isAnalyzing: boolean
  analysisError: string | null
  streamingContent: string
  onReAnalyze: (purpose?: string) => void
  chatHistory: ChatMessage[]
  isChatting: boolean
  chatError: string | null
  onSendFollowUp: (message: string) => void
}

// Format token count for display
function formatTokens(tokens: number | null): string {
  if (tokens === null) return '--'
  return tokens.toLocaleString()
}

// Streaming text display with cursor blinking effect
const StreamingDisplay: React.FC<{ content: string }> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom as content streams in
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [content])

  return (
    <div
      ref={containerRef}
      style={{
        padding: 16,
        overflow: 'auto',
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 8
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 16,
          background: '#1677ff',
          animation: 'blink 1s step-end infinite',
          verticalAlign: 'text-bottom',
          marginLeft: 2
        }}
      />
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// Report metadata panel
const ReportMeta: React.FC<{ report: AnalysisReport }> = ({ report }) => (
  <Descriptions
    size="small"
    column={{ xs: 1, sm: 2, md: 4 }}
    style={{ marginBottom: 16 }}
    bordered
  >
    <Descriptions.Item label="Provider">{report.llm_provider}</Descriptions.Item>
    <Descriptions.Item label="Model">{report.llm_model}</Descriptions.Item>
    <Descriptions.Item label="Prompt Tokens">
      {formatTokens(report.prompt_tokens)}
    </Descriptions.Item>
    <Descriptions.Item label="Completion Tokens">
      {formatTokens(report.completion_tokens)}
    </Descriptions.Item>
    <Descriptions.Item label="Created">
      {new Date(report.created_at).toLocaleString()}
    </Descriptions.Item>
    {report.prompt_tokens != null && report.completion_tokens != null && (
      <Descriptions.Item label="Total Tokens">
        {formatTokens(report.prompt_tokens + report.completion_tokens)}
      </Descriptions.Item>
    )}
  </Descriptions>
)

// Quick follow-up suggestions
const QUICK_QUESTIONS = [
  '生成完整的 Python 复现代码',
  '详细解释加密/签名流程',
  '分析潜在的安全风险',
  '列出所有 API 的请求参数和响应结构',
]

// Chat input component with quick suggestions
const ChatInput: React.FC<{ onSend: (msg: string) => void; disabled: boolean }> = ({ onSend, disabled }) => {
  const [input, setInput] = useState('')

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setInput('')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {QUICK_QUESTIONS.map((q, i) => (
          <Tag
            key={i}
            color="default"
            style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
            onClick={() => { if (!disabled) onSend(q) }}
          >
            {q}
          </Tag>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入追问..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={disabled}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          style={{ alignSelf: 'flex-end' }}
        />
      </div>
    </div>
  )
}

const ReportView: React.FC<ReportViewProps> = ({
  report,
  isAnalyzing,
  analysisError,
  streamingContent,
  onReAnalyze,
  chatHistory,
  isChatting,
  chatError,
  onSendFollowUp
}) => {
  // Analyzing state: show streaming content or spinner
  if (isAnalyzing) {
    return (
      <div style={{ padding: '16px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 16,
            gap: 8
          }}
        >
          <Spin size="small" />
          <Text>
            <RobotOutlined style={{ marginRight: 4 }} />
            AI is analyzing captured data...
          </Text>
        </div>
        {streamingContent ? (
          <StreamingDisplay content={streamingContent} />
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: 'rgba(255, 255, 255, 0.45)'
            }}
          >
            <Spin />
            <div style={{ marginTop: 12 }}>Preparing analysis...</div>
          </div>
        )}
      </div>
    )
  }

  // No report yet
  if (!report) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 200,
          gap: 16
        }}
      >
        {analysisError && (
          <Alert
            type="error"
            showIcon
            closable
            message="分析失败"
            description={analysisError}
            style={{ width: '80%', maxWidth: 500, marginBottom: 8 }}
          />
        )}
        <Empty
          image={<FileTextOutlined style={{ fontSize: 48, color: 'rgba(255,255,255,0.25)' }} />}
          description="No analysis report yet"
        />
        <Button type="primary" icon={<RobotOutlined />} onClick={() => onReAnalyze()}>
          Start AI Analysis
        </Button>
      </div>
    )
  }

  const handleExport = async () => {
    if (!report) return
    const defaultName = `report-${new Date(report.created_at).toISOString().slice(0, 10)}-${report.llm_model}.md`

    // Build export content: report + follow-up chat
    let content = report.report_content
    const followUps = chatHistory.slice(2) // skip initial system + user prompt
    if (followUps.length > 0) {
      content += '\n\n---\n\n## 追问对话\n'
      for (const msg of followUps) {
        const label = msg.role === 'user' ? '**用户**' : '**AI**'
        content += `\n${label}:\n\n${msg.content}\n`
      }
    }

    await window.electronAPI.exportFile(defaultName, content)
  }

  // Display completed report
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 0' }}>
      {/* Scrollable report content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            <RobotOutlined style={{ marginRight: 8 }} />
            协议分析报告
          </Title>
          <Space>
            <Button
              icon={<ExportOutlined />}
              onClick={handleExport}
              size="small"
            >
              Export .md
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onReAnalyze()}
              size="small"
            >
              Re-analyze
            </Button>
          </Space>
        </div>

        <ReportMeta report={report} />

        <div
          className="report-markdown-content"
          style={{
            padding: 16,
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 8,
            overflowWrap: 'break-word',
            wordBreak: 'break-word'
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {report.report_content}
          </ReactMarkdown>
        </div>

        {/* Chat history messages (scrollable with report) */}
        {chatHistory.slice(2).map((msg, i) => (
          <div
            key={i}
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 8,
              background: msg.role === 'user'
                ? 'rgba(22, 119, 255, 0.1)'
                : 'rgba(255, 255, 255, 0.02)',
              borderLeft: msg.role === 'user'
                ? '3px solid #1677ff'
                : '3px solid #52c41a',
            }}
          >
            <Tag
              color={msg.role === 'user' ? 'blue' : 'green'}
              style={{ marginBottom: 4 }}
            >
              {msg.role === 'user' ? '你' : 'AI'}
            </Tag>
            <div className="report-markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {isChatting && streamingContent && (
          <div style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.02)',
            borderLeft: '3px solid #52c41a',
          }}>
            <Tag color="green" style={{ marginBottom: 4 }}>AI</Tag>
            <StreamingDisplay content={streamingContent} />
          </div>
        )}

        {isChatting && !streamingContent && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <Spin size="small" />
            <Text style={{ marginLeft: 8, color: 'rgba(255, 255, 255, 0.45)' }}>思考中...</Text>
          </div>
        )}

        {chatError && (
          <Alert
            type="error"
            showIcon
            closable
            message="追问失败"
            description={chatError}
            style={{ marginTop: 12 }}
          />
        )}
      </div>

      {/* Fixed chat input at bottom */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        paddingTop: 10,
        marginTop: 8,
      }}>
        <ChatInput onSend={onSendFollowUp} disabled={isChatting} />
      </div>

      <style>{`
        .report-markdown-content h1,
        .report-markdown-content h2,
        .report-markdown-content h3 {
          color: rgba(255, 255, 255, 0.85);
          margin-top: 16px;
        }
        .report-markdown-content p {
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.8;
        }
        .report-markdown-content code {
          background: rgba(255, 255, 255, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
        }
        .report-markdown-content pre {
          background: rgba(0, 0, 0, 0.3);
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
        }
        .report-markdown-content pre code {
          background: transparent;
          padding: 0;
        }
        .report-markdown-content table {
          width: 100%;
          border-collapse: collapse;
          display: block;
          overflow-x: auto;
        }
        .report-markdown-content th,
        .report-markdown-content td {
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 8px;
          text-align: left;
        }
        .report-markdown-content th {
          background: rgba(255, 255, 255, 0.04);
        }
        .report-markdown-content blockquote {
          border-left: 3px solid #1677ff;
          padding-left: 12px;
          color: rgba(255, 255, 255, 0.55);
        }
        .report-markdown-content ul,
        .report-markdown-content ol {
          color: rgba(255, 255, 255, 0.65);
        }
        .report-markdown-content a {
          color: #1677ff;
        }
      `}</style>
    </div>
  )
}

export default ReportView
