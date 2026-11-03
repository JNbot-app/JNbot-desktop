import React, { useCallback, useState } from 'react';
import { Badge, Button, Flex, Popover, Tooltip, Typography, theme } from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  selectNotifications,
  clearNotifications,
  readNotification,
} from '../../redux/settings';
import type { Announcement } from '../announcements/announcement';
import { useAnnouncement } from '../announcements/AnnouncementProvider';
import { AnnouncementContent } from '../announcements/AnnouncementViews';
import time_ago from './functions/intervalFormatter';
import type { NotificationButton } from '../../../common/mobileClientContract';
import useNotificationButton from '../../hooks/useNotificationButton';

type NotificationType = 'success' | 'error' | 'warning' | 'info';

const notificationTypes: Record<NotificationType, React.JSX.Element> = {
  success: <CheckCircleOutlined />,
  error: <CloseCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  info: <InfoCircleOutlined />,
};

export type NotificationT = {
  title: string;
  timestamp: number;
  message: string;
  type: NotificationType;
  buttons?: NotificationButton[];
};

function NotificationButtons({
  buttons,
  onOpen,
}: {
  buttons: NotificationButton[];
  onOpen: () => void;
}): React.JSX.Element {
  const openButton = useNotificationButton();
  return (
    <Flex gap="small" wrap>
      {buttons.map((button) => (
        <Button
          key={button.label}
          size="small"
          onClick={() => {
            onOpen();
            openButton(button);
          }}
        >
          {button.label}
        </Button>
      ))}
    </Flex>
  );
}

type DisplayNotification =
  | { kind: 'system'; notification: NotificationT; unread: boolean }
  | { kind: 'announcement'; announcement: Announcement };

function Notifications(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { announcement, isDismissed } = useAnnouncement();
  const { token } = theme.useToken();
  const notifications: { notifications: NotificationT[]; unread: number } =
    useSettingsStore(selectNotifications);
  const displayNotifications: DisplayNotification[] = [
    ...(announcement
      ? [{ kind: 'announcement', announcement } satisfies DisplayNotification]
      : []),
    ...notifications.notifications.map((notification, index) => ({
      kind: 'system' as const,
      notification,
      unread: index < notifications.unread,
    })),
  ];
  const unread = notifications.unread + (announcement && !isDismissed ? 1 : 0);

  const removeNotifications = useCallback(() => {
    clearNotifications();
    setOpen(false);
  }, []);

  const openNotifications = useCallback(() => {
    setOpen(true);
  }, []);

  const openChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) readNotification();
    setOpen(nextOpen);
  }, []);

  return (
    <Popover
      content={
        <Flex
          vertical
          className="notifications-popover"
        >
          {displayNotifications.length === 0 ? (
            <Typography.Text type="secondary" className="notifications-empty">
              No notifications
            </Typography.Text>
          ) : (
            displayNotifications.map((item) => {
              if (item.kind === 'announcement') {
                return (
                  <div className="notification-item" key="announcement">
                    <AnnouncementContent
                      announcement={item.announcement}
                      onDismiss={undefined}
                    />
                  </div>
                );
              }

              const { notification } = item;
              return (
                <Flex
                  gap="small"
                  align="flex-start"
                  className="notification-item"
                  key={`${notification.timestamp}-${notification.title}`}
                  style={
                    item.unread
                      ? { background: token.colorFillAlter }
                      : undefined
                  }
                >
                  <span className="notification-icon" aria-hidden="true">
                    {notificationTypes[notification.type]}
                  </span>
                  <Flex
                    vertical
                    gap={token.marginXXS}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Flex justify="space-between" gap="small">
                      <Typography.Text strong>
                        {notification.title}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        className="notification-time"
                      >
                        {time_ago(new Date(notification.timestamp))}
                      </Typography.Text>
                    </Flex>
                    <Typography.Text>{notification.message}</Typography.Text>
                    {notification.buttons?.length ? (
                      <NotificationButtons
                        buttons={notification.buttons}
                        onOpen={() => openChange(false)}
                      />
                    ) : null}
                  </Flex>
                </Flex>
              );
            })
          )}
        </Flex>
      }
      title={
        <Flex justify="space-between" align="center">
          <Typography.Text strong>Notifications</Typography.Text>
          <Tooltip title="Clear notifications">
            <Button
              onClick={removeNotifications}
              type="link"
              icon={<ClearOutlined />}
              aria-label="Clear notifications"
              disabled={notifications.notifications.length === 0}
            />
          </Tooltip>
        </Flex>
      }
      placement="bottomLeft"
      trigger="click"
      open={open}
      onOpenChange={openChange}
    >
      <Badge count={unread} overflowCount={99} offset={[-8, 8]}>
        <Button
          type="text"
          shape="circle"
          style={{ margin: 0 }}
          icon={<BellOutlined />}
          onClick={openNotifications}
          id="notifications"
          aria-label="Open notifications"
        />
      </Badge>
    </Popover>
  );
}

export default Notifications;
