


function onlineTime(time) {
  let result = []
    // [days, hours, minutes, seconds]
    ;[ [ "d", 86400000 ], [ "h", 3600000 ], [ "m", 60000 ], [ "s", 1000 ] ].forEach(([ name, val ]) => {
      let num = Math.floor(time / val)
      if (num > 0) {
        result.push(num + name)
        time -= num * val
      }
    })
  if (result.length === 0) result.push("0s")
  return result.slice(0, 2).join(" ")
}
export default onlineTime