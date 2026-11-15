// madoo.kr, www.madoo.kr 로 들어온 접속을 장부선생 대문(jangbu.madoo.kr)으로 넘긴다.
// 나중에 madoo.kr에 회사 소개 페이지를 둘 수 있으므로 임시 이동(302)을 쓴다. 그때는 이 Worker를 지우면 된다.
const TARGET = 'https://jangbu.madoo.kr/';
export default {
  fetch() {
    return new Response(null, { status: 302, headers: { Location: TARGET, 'Cache-Control': 'no-store' } });
  },
};
