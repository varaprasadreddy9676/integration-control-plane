import { Skeleton } from 'antd';
import type { FormInstance } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { ConfigurationSection } from '../../../components/detail/ConfigurationSection';
import { SectionHeader } from './SectionHeader';

interface ConfigurationPanelProps {
  form: FormInstance;
  eventTypes: any[];
  uiConfig: any;
  tenant: any;
  isMultiAction: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedEntityRids?: any[];
  spacing: Record<string, string>;
  token: any;
  colors: any;
  isLoading?: boolean;
}

export const ConfigurationPanelHeader = ({
  spacing,
  colors
}: Pick<ConfigurationPanelProps, 'spacing' | 'colors'>) => (
  <SectionHeader
    icon={<ApiOutlined style={{ fontSize: 18, color: colors.primary[600] }} />}
    title="Configuration"
    spacing={spacing}
  />
);

export const ConfigurationPanelContent = ({
  form,
  eventTypes,
  uiConfig,
  tenant,
  isMultiAction,
  eventTypesLoading,
  scopeValue,
  excludedEntityRids,
  spacing,
  token,
  colors,
  isLoading = false
}: ConfigurationPanelProps) => (
  isLoading ? (
    <div style={{ padding: spacing[3] }}>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  ) : (
    <ConfigurationSection
      form={form}
      eventTypes={eventTypes}
      uiConfig={uiConfig}
      tenant={tenant}
      isMultiAction={isMultiAction}
      eventTypesLoading={eventTypesLoading}
      scopeValue={scopeValue}
      excludedEntityRids={excludedEntityRids}
      spacing={spacing}
      token={token}
      colors={colors}
    />
  )
);
