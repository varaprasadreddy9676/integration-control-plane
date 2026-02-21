import { Space, Typography } from 'antd';
import { cssVar } from '../../../../../design-system/utils';

export const flattenFields = (fields: any[], parentPath = '', depth = 0): any[] => {
  return fields.flatMap((field) => {
    const path = field.path || [parentPath, field.name].filter(Boolean).join('.');
    const isComplex = field.type === 'object' || field.type === 'array';
    const typeBadge = field.type === 'array' ? 'Array' : field.type === 'object' ? 'Object' : null;

    const base = {
      key: path || field.name,
      label: field.description || field.name,
      description: field.description,
      type: field.type,
      path,
      name: field.name,
      required: field.required,
      itemType: field.itemType,
      itemSchema: field.itemSchema,
      properties: field.properties,
      children: field.children,
      depth,
      isComplex,
      typeBadge
    };

    const childProps = field.properties || field.children || field.fields || [];
    const arrayChildProps = field.itemSchema?.properties
      || field.itemSchema?.fields
      || field.itemSchema?.children
      || [];
    const children = [...childProps, ...arrayChildProps];

    if (children.length === 0) {
      return [base];
    }

    return [base, ...flattenFields(children, path, depth + 1)];
  });
};

export const buildFieldTree = (fields: any[], parentPath = ''): any[] => {
  return fields.map((field) => {
    const path = field.path || [parentPath, field.name].filter(Boolean).join('.');
    const childProps = field.properties || field.children || field.fields || [];
    const arrayChildProps = field.itemSchema?.properties
      || field.itemSchema?.fields
      || field.itemSchema?.children
      || [];
    const children = [...childProps, ...arrayChildProps];

    return {
      title: (
        <Space size={6}>
          <span>{field.description || field.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
            {path}
          </Typography.Text>
        </Space>
      ),
      value: path,
      key: path,
      selectable: true,
      children: children.length ? buildFieldTree(children, path) : undefined
    };
  });
};
