module.exports = {
  preset: 'ts-jest',
  transform: {
    '.spec.ts$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.test.json',
      },
    ],
  },
  testRegex: '.spec.ts$',
  collectCoverageFrom: ['lib/**/*.*.ts'],
  setupFiles: ['dotenv/config'],
  testEnvironment: 'node',
};
