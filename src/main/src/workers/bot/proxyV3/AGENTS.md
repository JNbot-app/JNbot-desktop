# Proxy Development Rules


## Rules & Info
- The proxy should not decode packets that we are not listening to. Decoding all packets causes too much delay/lag.
- The client/bot should store the state, NOT the proxy. This means that the proxy should NOT store the world, positions, chat, inventory, ... . 
- The proxy supports all minecraft version above 1.8, so keep in mind that protocol changes, it should therefore look at minecraft-data for packet definitions. 


## Coding
- Always apply minimal code change to the codebase. This keeps the code away from bloated code.
- Remove useless/dead code if you find any. You may also refactor to simplify the codebase. I prefer lower code line count. 