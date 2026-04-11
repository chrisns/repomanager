#!/usr/bin/env node
require('../handler')
  .cron()
  .then((result) => {
    console.log(JSON.stringify(result))
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
