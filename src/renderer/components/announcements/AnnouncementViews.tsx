import {
  Button,
  Card,
  Flex,
  Tooltip,
  Typography,
  theme as antTheme,
} from 'antd';
import { CloseOutlined, NotificationOutlined } from '@ant-design/icons';
import React, { type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Announcement, AnnouncementAction } from './announcement';
import { isSafeExternalUrl } from './announcement';
import { useAnnouncement } from './AnnouncementProvider';

function openExternal(event: MouseEvent<HTMLElement>, url: string): void {
  if (window.web) return;
  event.preventDefault();
  window.ipcRenderer.action('OPEN_URL', url);
}

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}): React.JSX.Element {
  if (!href || !isSafeExternalUrl(href)) return <span>{children}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => openExternal(event, href)}
    >
      {children}
    </a>
  );
}

function MarkdownCode({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  return <Typography.Text code>{children}</Typography.Text>;
}

function AnnouncementMarkdown({ body }: { body: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      className="announcement-markdown"
      skipHtml
      allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'a']}
      unwrapDisallowed
      transformLinkUri={(href) => (isSafeExternalUrl(href) ? href : '')}
      components={{ a: MarkdownLink, code: MarkdownCode }}
    >
      {body}
    </ReactMarkdown>
  );
}

function AnnouncementActions({
  actions,
}: {
  actions: AnnouncementAction[];
}): React.JSX.Element | null {
  if (actions.length === 0) return null;

  return (
    <Flex gap="small" wrap>
      {actions.map((action, index) => (
        <Button
          key={`${action.label}-${action.url}`}
          type={index === 0 ? 'primary' : 'default'}
          size="small"
          href={action.url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => openExternal(event, action.url)}
        >
          {action.label}
        </Button>
      ))}
    </Flex>
  );
}

export function AnnouncementContent({
  announcement,
  onDismiss,
}: {
  announcement: Announcement;
  onDismiss: (() => void) | undefined;
}): React.JSX.Element {
  const { token } = antTheme.useToken();

  return (
    <section aria-label={announcement.title ?? 'Announcement'}>
      <Flex align="flex-start" gap={token.marginSM}>
        <Flex
          align="center"
          justify="center"
          aria-hidden="true"
          style={{
            width: token.controlHeightLG,
            height: token.controlHeightLG,
            flex: '0 0 auto',
            color: token.colorPrimary,
            background: token.colorPrimaryBg,
            borderRadius: token.borderRadiusLG,
            fontSize: token.fontSizeLG,
          }}
        >
          <NotificationOutlined />
        </Flex>

        <Flex vertical gap={token.marginXS} style={{ flex: 1, minWidth: 0 }}>
          {announcement.title && (
            <Typography.Text strong>{announcement.title}</Typography.Text>
          )}
          <AnnouncementMarkdown body={announcement.body} />
          <AnnouncementActions actions={announcement.actions} />
        </Flex>

        {onDismiss && (
          <Tooltip title="Dismiss">
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-label="Dismiss announcement"
              icon={<CloseOutlined />}
              onClick={onDismiss}
            />
          </Tooltip>
        )}
      </Flex>
    </section>
  );
}

export function AnnouncementBanner(): React.JSX.Element | null {
  const { announcement, dismiss, isDismissed } = useAnnouncement();
  const { token } = antTheme.useToken();

  if (!announcement || isDismissed) return null;

  return (
    <Card
      size="small"
      variant="outlined"
      className="announcement-banner"
      style={{
        marginBottom: token.marginMD,
        borderColor: token.colorBorderSecondary,
      }}
      styles={{ body: { padding: token.paddingSM } }}
    >
      <AnnouncementContent announcement={announcement} onDismiss={dismiss} />
    </Card>
  );
}
