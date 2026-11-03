import { Modal, message, notification } from "antd"
import { MessageInstance } from "antd/es/message/interface"
import { HookAPI } from "antd/es/modal/useModal"
import { NotificationInstance } from "antd/lib/notification/interface"
import { FC, PropsWithChildren, createContext } from "react"

export type AppApiContextT  = {
  modal: HookAPI,
  message: MessageInstance
  snackbar: NotificationInstance
}

export const AppApiContext = createContext<AppApiContextT>({} as AppApiContextT)

const AppApiProvider:FC<PropsWithChildren> = ({ children }) => {
  const [modal, modalContextHolder] = Modal.useModal()
  const [messageApi, messageContextHolder] = message.useMessage();
  const [snackbarApi, snackbarContextHolder] = notification.useNotification({ top: 48 });

  return <AppApiContext.Provider value={{modal,message:messageApi, snackbar:snackbarApi}}>{children}
  {modalContextHolder}
  {messageContextHolder}
    {snackbarContextHolder}
  </AppApiContext.Provider>
}

export default AppApiProvider
