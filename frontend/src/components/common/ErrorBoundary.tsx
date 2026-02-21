import React from 'react';
import { Result, Button, Typography, Collapse } from 'antd';
import { logError } from '../../utils/error-logger';

const { Paragraph, Text } = Typography;
const { Panel } = Collapse;

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught error:', error, errorInfo);

    // Store error info for display in development mode
    this.setState({ errorInfo });

    logError(
      error,
      {
        componentStack: errorInfo.componentStack,
        type: 'react_error',
        errorBoundary: true
      },
      'ui_error'  // Category: UI/React component error
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      const isDevelopment = import.meta.env.DEV;

      return (
        <div
          style={{
            padding: 'var(--space-12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: 'var(--color-neutral-50)'
          }}
        >
          <div style={{ maxWidth: '800px', width: '100%' }}>
            <Result
              status="error"
              title="Something went wrong"
              subTitle={
                isDevelopment && this.state.error
                  ? this.state.error.message
                  : 'The error has been logged and our team will investigate. Please try refreshing the page.'
              }
              extra={[
                <Button type="primary" key="refresh" onClick={this.handleReset}>
                  Refresh Page
                </Button>,
                <Button key="home" onClick={this.handleGoHome}>
                  Go to Dashboard
                </Button>
              ]}
            />

            {isDevelopment && (this.state.error || this.state.errorInfo) && (
              <div style={{ marginTop: 'var(--space-8)', textAlign: 'left' }}>
                <Collapse>
                  <Panel header="Error Details (Development Mode Only)" key="1">
                    {this.state.error && (
                      <div style={{ marginBottom: 'var(--space-6)' }}>
                        <Text strong>Error Message:</Text>
                        <Paragraph
                          style={{
                            background: 'var(--color-neutral-100)',
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-sm)',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            marginTop: 'var(--space-2)'
                          }}
                        >
                          {this.state.error.message}
                        </Paragraph>
                      </div>
                    )}

                    {this.state.error?.stack && (
                      <div style={{ marginBottom: 'var(--space-6)' }}>
                        <Text strong>Stack Trace:</Text>
                        <Paragraph
                          style={{
                            background: 'var(--color-neutral-100)',
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-sm)',
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            marginTop: 'var(--space-2)',
                            maxHeight: '300px',
                            overflow: 'auto'
                          }}
                        >
                          {this.state.error.stack}
                        </Paragraph>
                      </div>
                    )}

                    {this.state.errorInfo?.componentStack && (
                      <div>
                        <Text strong>Component Stack:</Text>
                        <Paragraph
                          style={{
                            background: 'var(--color-neutral-100)',
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-sm)',
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            marginTop: 'var(--space-2)',
                            maxHeight: '300px',
                            overflow: 'auto'
                          }}
                        >
                          {this.state.errorInfo.componentStack}
                        </Paragraph>
                      </div>
                    )}
                  </Panel>
                </Collapse>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
