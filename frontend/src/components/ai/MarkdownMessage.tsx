import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Typography } from 'antd';

const { Text } = Typography;

interface MarkdownMessageProps {
  content: string;
  /** Pass true when the bubble has a dark (primary colour) background so text colours invert */
  inverted?: boolean;
  fontSize?: number;
}

export const MarkdownMessage = ({ content, inverted = false, fontSize = 13 }: MarkdownMessageProps) => {
  const textColor = inverted ? '#fff' : 'inherit';
  const codeBackground = inverted ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)';
  const blockBackground = inverted ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.04)';
  const borderColor = inverted ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)';

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Paragraphs
        p: ({ children }) => (
          <p style={{ margin: '0 0 8px', fontSize, color: textColor, lineHeight: 1.6 }}>
            {children}
          </p>
        ),
        // Inline code
        code: ({ children, className }) => {
          const isBlock = !!className;
          if (isBlock) {
            return (
              <code
                style={{
                  display: 'block',
                  background: blockBackground,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: fontSize - 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: inverted ? '#e6f3ff' : '#d63384',
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                  lineHeight: 1.5,
                  marginBottom: 8
                }}
              >
                {children}
              </code>
            );
          }
          return (
            <Text
              code
              style={{
                background: codeBackground,
                color: inverted ? '#e6f3ff' : undefined,
                fontSize: fontSize - 1,
                padding: '1px 4px',
                borderRadius: 3
              }}
            >
              {children}
            </Text>
          );
        },
        // Fenced code blocks
        pre: ({ children }) => (
          <pre style={{ margin: '0 0 8px', padding: 0 }}>
            {children}
          </pre>
        ),
        // Unordered lists
        ul: ({ children }) => (
          <ul style={{ margin: '0 0 8px', paddingLeft: 20, fontSize, color: textColor }}>
            {children}
          </ul>
        ),
        // Ordered lists
        ol: ({ children }) => (
          <ol style={{ margin: '0 0 8px', paddingLeft: 20, fontSize, color: textColor }}>
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li style={{ marginBottom: 2, lineHeight: 1.6 }}>{children}</li>
        ),
        // Headings — downscale so they don't dominate a chat bubble
        h1: ({ children }) => (
          <strong style={{ display: 'block', fontSize: fontSize + 2, color: textColor, marginBottom: 4 }}>{children}</strong>
        ),
        h2: ({ children }) => (
          <strong style={{ display: 'block', fontSize: fontSize + 1, color: textColor, marginBottom: 4 }}>{children}</strong>
        ),
        h3: ({ children }) => (
          <strong style={{ display: 'block', fontSize, color: textColor, marginBottom: 4 }}>{children}</strong>
        ),
        // Bold / italic
        strong: ({ children }) => (
          <strong style={{ color: textColor }}>{children}</strong>
        ),
        em: ({ children }) => (
          <em style={{ color: textColor }}>{children}</em>
        ),
        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote
            style={{
              margin: '0 0 8px',
              paddingLeft: 12,
              borderLeft: `3px solid ${borderColor}`,
              color: inverted ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)',
              fontStyle: 'italic'
            }}
          >
            {children}
          </blockquote>
        ),
        // Links
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: inverted ? '#a8d8ff' : '#1677ff' }}>
            {children}
          </a>
        ),
        // Horizontal rule
        hr: () => (
          <hr style={{ border: 'none', borderTop: `1px solid ${borderColor}`, margin: '8px 0' }} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
