import { App as AntdApp, message as globalMessage, notification as globalNotification } from 'antd';
import { useEffect } from 'react';

export const ToastHost = () => {
  const { message, notification } = AntdApp.useApp();

  useEffect(() => {
    globalMessage.config({
      duration: 3,
      maxCount: 3
    });
    globalNotification.config({
      placement: 'topRight',
      duration: 3.5,
      maxCount: 4
    });
  }, []);

  return null;
};
