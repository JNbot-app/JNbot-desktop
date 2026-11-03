import { useParams } from "react-router-dom";



const useBotId = () => {
    const { botId } = useParams<{ botId: string }>()
    return botId ? parseInt(botId) : null
}

export default useBotId;