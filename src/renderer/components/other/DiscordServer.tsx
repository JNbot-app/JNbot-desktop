import { Button } from "antd";
import { PropsWithChildren } from "react";
import { FaDiscord } from "react-icons/fa";



const DiscordServer: React.FC = () => {


    return (    
         <Button
          icon={<FaDiscord />}
          style={{ backgroundColor: '#5865F2', color: 'white', borderColor: '#5865F2' }}
          onClick={() => window.location.href = 'https://discord.gg/JNbGgypERe'}
        >
          Join Discord Server
        </Button>

    )

}



const DiscordServerLink: React.FC<PropsWithChildren> = ({children}) => {


    return <a href="https://discord.gg/JNbGgypERe" >
        {children}
    </a>
}

export { DiscordServer, DiscordServerLink };