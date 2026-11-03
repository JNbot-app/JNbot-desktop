import Tutorial from './Tutorial'
// https://youtu.be/lkBGJA_7hbo

const markdown = `
### What does gkit collector do?

Gkit collector claims your gkits and optionally trades them to your account.

### How does it work?

Your bots join the gamemode you have selected and claims the gkits you want.
After it has claimed the gkits the bot will either go to the next alt or trade its gkits to the account you have selected.
You must be logged in on that account if the trading option is enabled.
If the bot its inventory is filled and hasn't redeemed all gkits then it will stop claiming gkits and move to the next alt. 
You'll also be able to see if this happens in the terminal.

### Options

  * **gamemode**: The gamemode you want to claim gkits for.
  * **transfer items to**: The account you want to trade/gift your gkits to. Optional if you don't want to trade/gift your gkits.
  * **ignore alts**: The alts you don't want to open gkits on. If trading is enabled, JNbot will automaticly add your selected 'trade with' account to this list.
  * **ignore gkits**: The gkits you don't want to claim.
  * **start with**: Skip all previous alts and start claiming gkits from this one. The order is the same as your alts list.
  * **trading**: 
    * **enable trading**: Whether the bot should trade its gkits to the account you have selected or not (for every gamemode besides skyblock dream).
    * **item transfer**: This option is currently only available in SkyblockDream. It has 1 extra option to gift your items. The bot will gift its items using /gift [username]. You don't have to be online if the last option is enabled. Do /maildelivery on your main to get the items.
  * **bot amount**: The number of bots you that will join at the same time. It's not recommended to set this higher than 1 if your internet connection is slow.

In the settings you can find an option called 'Filter alts', if this option is enabled gkit collector will only join with the alts that have at least 1 gkit that you want to claim.


### Showcase

`

const GkitCollectorTutorial = ({ refEl }) => {
  return (
    <Tutorial markdown={markdown} title='Gkit collector docs' ref={refEl}>
      <iframe
        style={{ border: 'none' }}
        width='100%'
        height='100%'
        src='https://www.youtube.com/embed/lkBGJA_7hbo'
      ></iframe>
    </Tutorial>
  )
}

export default GkitCollectorTutorial
