const request = require('request');
const { parse } = require('node-html-parser');
const { MongoClient } = require('mongodb');
const mongoURL = 'mongodb://localhost:27017';

const minID = 5700;
const maxID = 6300;
// const maxID = 3969;

function stringToByteArray(s) {
  // Otherwise, fall back to 7-bit ASCII only
  var result = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) {
    result[i] = s.charCodeAt(i);/* w ww. ja  v  a 2s . co  m*/
  }
  return result;
}

const getURL = (id) => {
  return `https://asia.pokemon-card.com/tw/card-search/detail/${id}/`
}

const getWeb = async (uri) => {
  return new Promise((r, rej) => {
    request({
      method: 'GET',
      uri,
      followRedirect: false,
    }, (err, response) => {
      if (err) {
        rej(err);
        return;
      }
      r(response.body);
    });
  })
}

const getPageContent = async (id) => {
  return new Promise((r, rej) => {
    request({
      method: 'GET',
      uri: getURL(id),
      followRedirect: false,
    }, (err, response) => {
      if (err) {
        rej(err);
        return;
      }
      if (response.statusCode >= 500) {
        rej('status 500');
      }
      if (response.body.indexOf('Redirecting to <a href="/tw/card-search/list/">/tw/card-search/list/</a>') > 0) {
        rej('no this card')
      }
      r(response.body);
    });
    // request.get(getURL(id), );
  })
}

const getImgSrc = (root, selector) => {
  return root.querySelector(selector)?.getAttribute('src') || '';
}

const getDOMText = (root, selector) => {
  return root.querySelector(selector)?.textContent.replace(/[\n ]/g, '') || '';
}

const getName = (root) => {
  let target = root.querySelector('.pageHeader.cardDetail');
  if (!target) {
    return '';
  }
  return (target.childNodes[2] || target)?.textContent.replace(/[\n ]/g, '') || '';
}

const getTypeName = (root, selector) => {
  const img = getImgSrc(root, selector);
  if (img === '') {
    return '';
  }
  const params = img.split("/");
  return params[params.length - 1].replace('.png', '');
}

const getSerial = (root, selector) => {
  const img = getImgSrc(root, selector);
  const params = img.split("/");
  return params[params.length - 1].replace('.png', '');
}

const getSerialNum = (root, selector) => {
  const txt = getDOMText(root, selector);
  const params = txt.split("/");
  if (params.length >= 2) {
    return params[0]
  }
  return txt;
}

const getSkill = (DOM) => {
  return {
    name: getDOMText(DOM, '.skillHeader > .skillName'),
    cost: DOM.querySelectorAll('.skillHeader > .skillCost > img')
      .map(i => i.getAttribute('src'))
      .map(src => {
        const params = src.split('/');
        if (params.length) {
          return params[params.length - 1].replace('.png', '');
        }
        return undefined
      })
      .filter(r => r !== undefined),
    damage: getDOMText(DOM, '.skillHeader > .skillDamage'),
    desc: getDOMText(DOM, '.skillEffect'),
  }
}

const getSkillList = (root) => {
  const skillContainer = root.querySelector('.skillInformation')
  return skillContainer.querySelectorAll('.skill')
    .map(s => getSkill(s)).filter(s => {
      return !/\[.*規則\]/.test(s.name)
    });
}

const getCardMetaFromWeb = async (id) => {
  const content = await getPageContent(id);
  const root = parse(content);
  const name = getName(root);
  const imgURL = getImgSrc(root, ".cardImage > img");
  let cardType = getDOMText(root, ".evolveMarker");
  if (cardType === '') {
    cardType = getDOMText(root, ".commonHeader");
  }
  const HP = getDOMText(root, ".mainInfomation > .number");
  const prop = getTypeName(root, ".mainInfomation > .type + img");
  const weekness = getTypeName(root, '.subInformation .weakpoint > img');
  const weeknessEffect = weekness === '' ? '' : getDOMText(root, '.subInformation .weakpoint');
  const resist = getTypeName(root, '.subInformation .resist > img');
  const resistEffect = resist === '' ? '' : getDOMText(root, '.subInformation .resist');
  const series = getSerial(root, '.expansionSymbol > img');
  const alpha = getDOMText(root, '.expansionColumn > p > .alpha');
  const num = getSerialNum(root, '.expansionColumn > p > .collectorNumber');
  const skill = getSkillList(root)
  const escape = root.querySelectorAll(".escape > img")?.length || 0;
  return {
    id,
    name,
    imgURL,
    cardType,
    HP,
    prop,
    skill,
    weekness,
    weeknessEffect,
    resistEffect,
    resist,
    series,
    alpha,
    num,
    escape,
  }
}

const getIDMeta = async (client, id) => {
  const metas = client.db('pokemon').collection('meta');
  const findResult = await metas.find({
    id,
  });
  const results = await findResult.toArray();
  return results[0];
}

const storeMeta = async (client, id, meta) => {
  const metas = client.db('pokemon').collection('meta');
  const query = { id };
  const update = { $set: meta };
  const options = { upsert: true };
  await metas.updateOne(query, update, options);
}

const getImageFile = async (url) => {
  return new Promise((r, rej) => {
    const https = require('https');
    https.get(url, function (response) {
      var data = [];

      response
        .on('data', function (chunk) {
          data.push(chunk);
        })
        .on('end', function () {
          var buffer = Buffer.concat(data);
          r(buffer);
        })
        .on('error', e => {
          rej(e);
        });
    });
  })
}

const saveImage = async (client, id, meta) => {
  const metas = client.db('pokemon').collection('images');

  const imageURL = meta.imgURL;
  const image = await getImageFile(imageURL);

  const query = { id };
  const update = {
    $set: {
      id,
      image,
    }
  };
  const options = { upsert: true };
  await metas.updateOne(query, update, options);

  const fs = require('fs');
  const file = fs.createWriteStream("test.png");
  file.write(image);
  file.close();
  return;
}

const runTask = async () => {
  const client = new MongoClient(mongoURL);
  await client.connect();
  await client.db('pokemon').command({ ping: 1 })


  // Testing
  // pokemon
  // await getCardMetaFromWeb(5639)
  // await getCardMetaFromWeb(3969)
  // await getCardMetaFromWeb(2719)
  // // item
  // await getCardMetaFromWeb(6006)
  // // trainer
  // await getCardMetaFromWeb(6020)
  // // ground
  // await getCardMetaFromWeb(5357)
  // // energy
  // await getCardMetaFromWeb(6038)
  // // energy
  // await getCardMetaFromWeb(6045)

  const delay = (ms) => {
    return new Promise(r => {
      setTimeout(() => { r(); }, ms);
    })
  }

  for (let i = minID; i <= maxID; i++) {
    const origData = await getIDMeta(client, i);
    if (!origData) {
      console.log(`Get Data of ${i}`);
      try {
        let meta = await getCardMetaFromWeb(i);
        console.log(`Success, Get data of ${meta.name}`);
        await storeMeta(client, i, meta);
        await saveImage(client, i, meta);
        console.log(`Success, Save data of ${meta.name}`);
        await delay(300 + parseInt(Math.random() * 100, 10));
      } catch (e) {
        console.log('Fail: ', e);
      }
    }
  }
  process.exit(0);
}

runTask();
