import { Button } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

interface CollapsibleControlsProps {
  onExpandAll: () => void;
  onCollapseAll: () => void;
  spacing: Record<string, string>;
}

export const CollapsibleControls = ({
  onExpandAll,
  onCollapseAll,
  spacing
}: CollapsibleControlsProps) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      marginBottom: spacing[3],
      gap: spacing[2]
    }}
  >
    <Button size="small" icon={<DownOutlined />} onClick={onExpandAll} type="text">
      Expand All
    </Button>
    <Button size="small" icon={<UpOutlined />} onClick={onCollapseAll} type="text">
      Collapse All
    </Button>
  </div>
);
