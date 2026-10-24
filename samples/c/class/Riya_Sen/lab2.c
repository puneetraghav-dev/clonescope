#include <stdio.h>

int main(void)
{
    int n, i, total, big, small, second, have2, ev, od, ok;
    int arr[100];
    scanf("%d", &n);
    i = 0;
    while (i < n)
    {
        scanf("%d", &arr[i]);
        i = i + 1;
    }
    total = 0; ev = 0; od = 0;
    big = arr[0]; small = arr[0];
    i = 0;
    while (i < n)
    {
        total = total + arr[i];
        if (arr[i] > big) big = arr[i];
        if (arr[i] < small) small = arr[i];
        if (arr[i] % 2 == 0) ev = ev + 1; else od = od + 1;
        i = i + 1;
    }
    have2 = 0; second = 0;
    i = 0;
    while (i < n)
    {
        if (arr[i] < big)
        {
            if (have2 == 0 || arr[i] > second) { second = arr[i]; have2 = 1; }
        }
        i = i + 1;
    }
    printf("Sum: %d\n", total);
    printf("Average: %.2f\n", total / (double)n);
    printf("Max: %d\n", big);
    printf("Min: %d\n", small);
    if (have2 == 1) printf("Second largest: %d\n", second);
    else printf("Second largest: none\n");
    printf("Even: %d Odd: %d\n", ev, od);
    printf("Reversed:");
    i = n - 1;
    while (i >= 0) { printf(" %d", arr[i]); i = i - 1; }
    printf("\n");
    ok = 1;
    i = 0;
    while (i < n / 2) { if (arr[i] != arr[n - 1 - i]) ok = 0; i = i + 1; }
    if (ok) printf("Palindrome: Yes\n"); else printf("Palindrome: No\n");
    return 0;
}
