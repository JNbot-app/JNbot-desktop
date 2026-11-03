


function getCommand(gamemode) {
  if (global.appSettings.server === 'pikanetwork') {
    switch (gamemode.toLowerCase().replace(/[^a-z]/g, '')) {
      case 'opfactions':
      case 'factions':
        return ['/server opfactions', '/server', 10, '*'];
      case 'opskyblock':
        return ['/server opskyblock', '/server', 12, '*'];
      case 'classicskyblock':
      case 'skyblock':
        return ['/server skyblock', '/server', 12, '1.18.0'];
      case 'opprison':
        return ['/server opprison', '/server', 14, '1.19.0'];
      case 'kitpvp':
      case 'kit-pvp':
        return ['/server kit-pvp', '/server', 21, '*'];
      case 'practicepvp':
        return ['/server practice', '/server', 19, '*'];
      case 'survival':
        return ['/server survival', '/server', 23, '1.8.0'];
      case 'skywars':
        return ['/server skywars', '/server', 28, '*'];
      case 'bedwars':
        return ['/server bedwars', '/server', 30, '*'];
      case 'lifesteal':
      case 'oplifesteal':
        return ['/server lifesteal', '/server', 32, '1.16.0'];
      case 'skypvp':
        return [null, '/server', 39, '*'];
      case 'genpvp':
        return ['/server genpvp', '/server', 39, '1.20.0'];  
      case 'skymines':
        return ['/server skymines', '/server', 37, '1.18.0'];
      case 'dungeons':
        return ['/server dungeons', '/server', 49, '1.20.3'];
      default:
        log('[Error] Unknown gamemode: ' + gamemode.toLowerCase());
        return [
          '/server ' + gamemode.toLowerCase().replace(/[^ ]/g, ''),
          '/server',
          0,
          '*',
        ];
    }
  } else {
    switch (gamemode.toLowerCase().replace(/[^a-z]/g, '')) {
      case 'sbd':
      case 'skyblockdream':
        return ['/server skyblockdream', '/skyblock', 15, '*'];
      case 'sbf':
      case 'skyblockfantasy':
        return ['/server skyblockfantasy', '/skyblock', 11, '1.16.5'];
      case 'factions':
      case 'factionsimmortal':
        return ['/server factionsImmortal', '/server', 10, '*'];
      case 'prison':
        return ['/server prison', '/server', 14, '*'];
      case 'survival':
      case 'ꜱᴜʀᴠɪᴠᴀʟ':
      case 'spawnworld':
        return ['/server survival', '/server', 19, '1.19.2'];
      case 'thebridge':
        return [null, '/server', 23, '*'];
      case 'kitpvp':
        return ['/server kitpvp', '/server', 21, '*'];
      case 'bedwars':
        return ['/server bedwars', '/server', 32, '*'];
      case 'lifesteal':
      case 'ʟɪᴇꜱᴛᴇᴀʟ': // for some reason it's liesteal here
      case 'lieꜱteal':
        return ['/server lifesteal', '/server', 28, '1.20.4'];
      case 'ɢᴇɴꜱ':
      case 'gens':
        return ['/server gens', '/server', 39, '1.18.2'];
      case "oneblock":
        return [null, '/server', 42, '1.18.2'];
      default:
        log('[Error] Unknown gamemode: ' + gamemode.toLowerCase());
        return [
          '/server ' + gamemode.toLowerCase().replace(/[^ ]/g, ''),
          '/server',
          0,
          '*',
        ];
    }
  }
}


module.exports = getCommand
