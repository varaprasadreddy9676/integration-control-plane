import { Children } from 'react';
import type { CollapseProps } from 'antd';

export const buildSectionItems = (children: React.ReactNode) => {
  return Children.map(children as any, (child: any) =>
    child ? { key: child.key, label: child.props.header, children: child.props.children } : null
  )?.filter(Boolean) as CollapseProps['items'];
};
