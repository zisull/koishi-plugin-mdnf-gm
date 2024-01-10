import { Context } from 'koishi';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const pluginDirectory = __dirname;
const itemCodesFile = path.join(pluginDirectory, 'item_codes.json');
const configFile = path.join(pluginDirectory, 'config.json');

export async function apply(ctx: Context) {
  const itemCodes = await readItemCodesFromFile(itemCodesFile);
  const config = await readConfigFromFile(configFile);

  ctx.middleware(async (session, next) => {
    try {
      const itemCommand = /^#(\d+)$/;
      const match = session.content.match(itemCommand);

      if (match) {
        const itemId = parseInt(match[1], 10);
        await handleItemCommand(session, itemId, itemCodes, config);
      } else {
        await handleUserInput(session, session.content, itemCodes, config);
      }
    } catch (error) {
      session.send(`发生错误:${error.message}`);
    } finally {
      next();
    }
  });
}

async function handleItemCommand(session, itemId, itemCodes, config) {
  const userId = session.userId;
  const userAccount = config.userAccounts[userId];

  if (!userAccount) {
    return session.send('请先绑定账号，使用命令 #绑定 账号');
  }

  const quantity = await session.prompt('请输入要发送的物品数量:', { time: 60000 });

  try {
    const response = await sendItemsRequest(userAccount, itemId, quantity);

    const item = findItemById(itemId, itemCodes);
    const itemName = item ? item.itemName : '未知物品';
    const itemCode = item ? item.itemCode : itemId;

    session.send(`成功发送物品:${itemName} - ${itemCode}（${quantity}个)。服务器响应:${response.data}`);
  } catch (error) {
    throw new Error(`发送物品时出错:${error.message}`);
  }
}

async function handleUserInput(session, input, itemCodes, config) {
  const userId = session.userId;
  const userInput = input.trim();

  if (userInput.startsWith('#绑定')) {
    const accountToBind = userInput.substring(3).trim();
    config.userAccounts[userId] = accountToBind;
    await writeConfigToFile(configFile, config);
    session.send(`成功绑定账号:${accountToBind}`);
  } else if (userInput.startsWith('?') || userInput.startsWith('？')) {
    const query = userInput.substring(1).trim();
    const matchedItems = searchItemCode(query, itemCodes);

    if (matchedItems.length === 0) {
      return session.send('未找到匹配的物品。');
    }

    const selectedItemId = await sendAndPrompt(session, matchedItems);

    if (selectedItemId) {
      const selectedItem = matchedItems[selectedItemId - 1];
      const userAccount = config.userAccounts[userId];
      const quantity = await session.prompt('请输入要发送的物品数量:', { time: 60000 });

      try {
        const response = await sendItemsRequest(userAccount, selectedItem.itemCode, quantity);

        session.send(`成功发送物品:${selectedItem.itemName} - ${selectedItem.itemCode}（${quantity}个)。服务器响应:${response.data}`);
      } catch (error) {
        throw new Error(`发送物品时出错:${error.message}`);
      }
    } else {
      session.send('已取消发送物品。');
    }
  } else if (userInput.startsWith('#注册')) {
    const [username, password] = userInput.substring(3).split('-').map(item => item.trim());
    const registrationResponse = await registerAccount(session, username, password);
    session.send(registrationResponse);
  }
}

async function sendItemsRequest(userName, itemId, itemQuantity) {
  try {
    const requestData = {
      userName,
      title: 'GM',
      massage: 'zisull@qq.com',
      items: `${itemId}@${itemQuantity}`,
    };

    console.log('POST请求数据:', requestData);

    const response = await axios.post('http://42.193.106.191:20001/gm/sendItems', requestData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; Charset=UTF-8',
        'Accept': '*/*',
        'Accept-Language': 'zh-cn',
        'Referer': 'http://42.193.106.191:20001/gm/sendItems',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
      },
    });

    console.log('POST响应数据:', response.data);

    return response;
  } catch (error) {
    throw new Error(`发送物品时出错:${error.message}`);
  }
}
async function registerAccount(session, username, password) {
  const url = 'http://42.193.106.191/sdk/account/register';
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };

  const data = {
    username,
    password,
    code: '1',
    timestamp: String(Math.floor(Date.now() / 1000)),
    token: 'HFdmJ2ZRtXOTcBQW5DWEhSWQ0CBjQxZwkgBAkvDTA9CjEhezgUAmoMcBxSUDhWMDojFgFcEhEFX1dIQAU2QhUeUQUbXh4mKh0kJHgrARITGG8LGQMGXm96fAIVWUJHXgYFelZRYjlMWG5YDD4MMSJ7ODFwbwhIXkxxamdmF2h5X3cAXzNofnNPUHhFESMxAQ1T',
  };

  try {
    const response = await axios.post(url, data, { headers });
   // session.send('Status Code:', response.status);
    //session.send('Response Text:', response.data);

    if (response.status === 200 && response.data.status === '1') {
      return '账号注册成功';
    } else {
      return '账号注册失败';
    }
  } catch (error) {
    console.error('注册账号时出错:', error.message);
    return `注册账号时出错:${error.message}`;
  }
}

function searchItemCode(query, itemCodes) {
  const regex = new RegExp(query, 'i');
  return Object.entries(itemCodes)
    .filter(([code, itemName]) => regex.test(itemName as string))
    .map(([itemCode, itemName]) => ({ itemCode, itemName }));
}

async function sendAndPrompt(session, items) {
  const message = items
    .map((item, index) => `${index + 1}. ${item.itemName} - ${item.itemCode}`)
    .join('\n');

  session.send(`找到多个匹配的物品:\n${message}\n输入0退出。`);

  const userInput = (await session.prompt('请选择要发送的物品序号（输入数字或0):', { time: 60000 })).trim();
  const selectedItemId = parseInt(userInput, 10);

  if (isNaN(selectedItemId) || selectedItemId < 0 || selectedItemId > items.length) {
    session.send('无效的选择。已取消发送物品。');
    return null;
  }

  return selectedItemId;
}

function findItemById(itemId, itemCodes) {
  const item = Object.entries(itemCodes).find(([code, name]) => parseInt(code, 10) === itemId);
  return item ? { itemCode: item[0], itemName: item[1] } : null;
}

async function readItemCodesFromFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('读取物品代码文件失败:', error);
    return {};
  }
}

async function readConfigFromFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('读取配置文件失败:', error);
    return { userAccounts: {} };
  }
}

async function writeConfigToFile(filePath, config) {
  try {
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('写入配置文件失败:', error);
  }
}
