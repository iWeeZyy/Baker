import { useLocalSearchParams } from 'expo-router';
import { FollowListScreen } from '@/src/FollowListScreen';

export default function FollowingScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <FollowListScreen userId={userId} kind="following" />;
}
