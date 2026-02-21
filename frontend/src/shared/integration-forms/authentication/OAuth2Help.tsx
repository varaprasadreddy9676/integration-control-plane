import { Popover } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

interface HelpPopoverProps {
  title: string;
  content: React.ReactNode;
}

/**
 * HelpPopover - Reusable help icon with popover
 */
export const HelpPopover = ({ title, content }: HelpPopoverProps) => (
  <Popover title={title} content={content} trigger="hover">
    <QuestionCircleOutlined
      style={{
        color: '#8c8c8c',
        cursor: 'help',
        fontSize: 14
      }}
    />
  </Popover>
);
