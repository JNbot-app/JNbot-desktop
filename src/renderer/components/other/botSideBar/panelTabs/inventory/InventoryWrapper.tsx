import Inventory from './Inventory'
import Toolbar from '../../../../../extra/components/Toolbar'
import Sidebar from './Sidebar'
import { useRef } from 'react'
import useBotId from './useBotId'

const InventoryWrapper = () => {
  const toolbarRef = useRef(null)
  const botId= useBotId()
  if(!botId) return <div>No bot selected</div>
  return (
    <>
      <Toolbar
        ref={toolbarRef}
        title='Inventory'
      />
      <div
        className='unselectable'
        style={{ display: 'flex', position: 'relative' }}
      >
        <Inventory botId={botId} />
        <Sidebar />
      </div>
    </>
  )
}

export default InventoryWrapper
