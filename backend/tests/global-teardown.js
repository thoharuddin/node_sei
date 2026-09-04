'use strict';

module.exports = async () => {
  const { prisma } = require('../src/database/prisma');
  await prisma.$disconnect();
};
