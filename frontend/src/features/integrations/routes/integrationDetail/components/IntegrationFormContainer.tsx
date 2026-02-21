import { Form } from 'antd';
import type { FormInstance } from 'antd';
import type { ReactNode } from 'react';

interface IntegrationFormContainerProps {
  form: FormInstance;
  initialValues: any;
  onFinish: (values: any) => void;
  children: ReactNode;
}

export const IntegrationFormContainer = ({
  form,
  initialValues,
  onFinish,
  children
}: IntegrationFormContainerProps) => {
  return (
    <Form
      layout="vertical"
      form={form}
      initialValues={initialValues}
      onFinish={onFinish}
      onValuesChange={() => {}}
    >
      {children}
    </Form>
  );
};
